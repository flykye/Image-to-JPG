package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/egoist/mygo"
)

type GroupResult struct {
	Directory             string  `json:"directory"`
	OutputDir             string  `json:"outputDir"`
	TotalFiles            int     `json:"totalFiles"`
	ProcessedFiles        int     `json:"processedFiles"`
	SuccessfulConversions int     `json:"successfulConversions"`
	FailedConversions     int     `json:"failedConversions"`
	SkippedFiles          int     `json:"skippedFiles"`
	Duration              float64 `json:"duration"`
}

type BatchResult struct {
	Status                string        `json:"status"`
	ScanErrors            []ScanError   `json:"scanErrors"`
	TotalFiles            int           `json:"totalFiles"`
	ProcessedFiles        int           `json:"processedFiles"`
	SuccessfulConversions int           `json:"successfulConversions"`
	FailedConversions     int           `json:"failedConversions"`
	SkippedFiles          int           `json:"skippedFiles"`
	Duration              float64       `json:"duration"`
	Cancelled             bool          `json:"cancelled"`
	Groups                []GroupResult `json:"groups"`
}

type ScanError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Input      string `json:"input"`
	SystemCode string `json:"systemCode"`
}

type ConversionDetails struct {
	Skipped    bool  `json:"skipped"`
	InputSize  int64 `json:"inputSize"`
	OutputSize int64 `json:"outputSize"`
	Quality    *int  `json:"quality"`
	Attempts   int   `json:"attempts"`
}

type ProgressEvent struct {
	Type                 string             `json:"type"`
	Filename             string             `json:"filename,omitempty"`
	Input                string             `json:"input,omitempty"`
	FileType             string             `json:"fileType,omitempty"`
	OutputPath           string             `json:"outputPath,omitempty"`
	Directory            string             `json:"directory,omitempty"`
	Error                string             `json:"error,omitempty"`
	Message              string             `json:"message,omitempty"`
	TotalStats           map[string]int     `json:"totalStats,omitempty"`
	GroupCount           int                `json:"groupCount,omitempty"`
	GroupIndex           int                `json:"groupIndex,omitempty"`
	Group                *GroupResult       `json:"group,omitempty"`
	Details              *ConversionDetails `json:"details,omitempty"`
	Quality              int                `json:"quality,omitempty"`
	OutputSize           int64              `json:"outputSize,omitempty"`
	MaxOutputBytes       int64              `json:"maxOutputBytes,omitempty"`
	RequestedConcurrency int                `json:"requestedConcurrency,omitempty"`
	EffectiveConcurrency int                `json:"effectiveConcurrency,omitempty"`
	MemoryBudgetMb       float64            `json:"memoryBudgetMb,omitempty"`
}

type engineRequest struct {
	Action     string   `json:"action"`
	Paths      []string `json:"paths,omitempty"`
	Options    Settings `json:"options"`
	CancelFile string   `json:"cancelFile,omitempty"`
}

type cappedBuffer struct{ bytes.Buffer }

func (b *cappedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if remaining := 32768 - b.Len(); remaining > 0 {
		_, _ = b.Buffer.Write(p[:min(len(p), remaining)])
	}
	return n, nil
}

func engineLocation() (string, string, error) {
	resources, err := mygo.App.Path(mygo.PathResources)
	if err != nil {
		return "", "", err
	}
	exe := "node"
	if runtime.GOOS == "windows" {
		exe = "node.exe"
	}
	roots := []string{resources, filepath.Join(resources, runtime.GOOS+"-"+runtime.GOARCH)}
	for _, root := range roots {
		node := filepath.Join(root, "bin", exe)
		worker := filepath.Join(root, "engine", "src", "desktop", "worker.js")
		if _, err := os.Stat(node); err == nil {
			if _, err := os.Stat(worker); err == nil {
				return node, worker, nil
			}
		}
	}
	return "", "", errors.New("转换运行环境缺失，请重新安装或运行 npm run runtime:prepare")
}

func engineEnvironment() []string {
	// GUI apps launched by Finder do not inherit the user's shell PATH.
	env := make([]string, 0, len(os.Environ())+1)
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		if strings.EqualFold(key, "NODE_OPTIONS") || strings.EqualFold(key, "NODE_PATH") {
			continue
		}
		if runtime.GOOS == "darwin" && strings.EqualFold(key, "PATH") {
			continue
		}
		env = append(env, value)
	}
	if runtime.GOOS == "darwin" {
		env = append(env, "PATH=/opt/homebrew/bin:/usr/local/bin:"+os.Getenv("PATH")+":/usr/bin:/bin")
	}
	return env
}

func runEngine(ctx context.Context, request engineRequest, emit func(ProgressEvent), result any) error {
	node, worker, err := engineLocation()
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, node, worker)
	configureCommand(cmd)
	cmd.Env = engineEnvironment()
	input, err := json.Marshal(request)
	if err != nil {
		return err
	}
	cmd.Stdin = bytes.NewReader(append(input, '\n'))
	return executeEngine(ctx, cmd, emit, result)
}

func executeEngine(ctx context.Context, cmd *exec.Cmd, emit func(ProgressEvent), result any) error {
	var stderr cappedBuffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 65536), 2<<20)
	var payload json.RawMessage
	var protocolErr error
	for scanner.Scan() {
		var message struct {
			ProgressEvent
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			protocolErr = fmt.Errorf("转换进程返回了无效消息：%w", err)
			break
		}
		switch message.Type {
		case "result":
			payload = message.Result
		case "fatal-error":
			protocolErr = errors.New(message.Error)
		default:
			if emit != nil {
				emit(message.ProgressEvent)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		protocolErr = err
	}
	if protocolErr != nil {
		_ = cmd.Process.Kill()
	}
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if protocolErr != nil {
		return protocolErr
	}
	if waitErr != nil {
		return fmt.Errorf("转换进程异常退出：%w\n%s", waitErr, stderr.String())
	}
	if len(payload) == 0 {
		return errors.New("转换进程退出但未返回结果")
	}
	return json.Unmarshal(payload, result)
}
