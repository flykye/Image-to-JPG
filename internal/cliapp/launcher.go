// Package cliapp runs the bundled Node CLI without importing MyGO or starting a UI.
package cliapp

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

func mode(args []string) string {
	result := ""
	for _, arg := range args {
		if arg == "--" {
			break
		}
		if arg == "--json" {
			result = "json"
		}
		if arg == "--jsonl" && result != "json" {
			result = "jsonl"
		}
	}
	return result
}

func runtimePaths(executable string) (string, string, error) {
	resolved, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return "", "", err
	}
	executable = resolved
	root := filepath.Dir(executable)
	node := filepath.Join(root, "bin", "node")
	if runtime.GOOS == "windows" {
		node += ".exe"
	}
	cli := filepath.Join(root, "engine", "src", "cli", "index.js")
	for _, file := range []string{node, cli} {
		info, err := os.Stat(file)
		if err != nil {
			return "", "", fmt.Errorf("bundled CLI runtime missing: %s: %w", file, err)
		}
		if !info.Mode().IsRegular() {
			return "", "", fmt.Errorf("bundled CLI runtime is not a file: %s", file)
		}
	}
	return node, cli, nil
}

func environment(marker string) []string {
	result := []string{}
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		if strings.EqualFold(key, "NODE_OPTIONS") || strings.EqualFold(key, "NODE_PATH") || strings.EqualFold(key, "IMAGE_TO_JPG_CANCEL_FILE") {
			continue
		}
		if runtime.GOOS == "darwin" && strings.EqualFold(key, "PATH") {
			continue
		}
		result = append(result, value)
	}
	if runtime.GOOS == "darwin" {
		result = append(result, "PATH=/opt/homebrew/bin:/usr/local/bin:"+os.Getenv("PATH")+":/usr/bin:/bin")
	}
	return append(result, "IMAGE_TO_JPG_CANCEL_FILE="+marker)
}

func failure(args []string, version string, err error, stdout, stderr io.Writer) int {
	result := map[string]any{
		"schemaVersion": 1, "version": version, "status": "invalid",
		"inputDirectories": []string{}, "outputDirectory": nil,
		"total": 0, "processed": 0, "converted": 0, "skipped": 0, "failed": 0, "pending": 0,
		"scanComplete": false, "scanErrors": []any{}, "warnings": []any{}, "files": []any{}, "durationMs": 0,
		"error": map[string]any{"code": "ENVIRONMENT_ERROR", "message": err.Error(), "input": nil, "systemCode": nil},
	}
	fmt.Fprintln(stderr, "ENVIRONMENT_ERROR:", err)
	switch mode(args) {
	case "json":
		_ = json.NewEncoder(stdout).Encode(result)
	case "jsonl":
		_ = json.NewEncoder(stdout).Encode(map[string]any{"schemaVersion": 1, "type": "result", "result": result})
	}
	return 2
}

// Run resolves resources beside the launcher. It never depends on cwd or a
// globally installed Node. Windows callers can use --cancel-file for graceful
// cancellation even when their process API can only force-terminate a PID.
func Run(args []string, version string) int {
	executable, err := os.Executable()
	if err != nil {
		return failure(args, version, err, os.Stdout, os.Stderr)
	}
	node, cli, err := runtimePaths(executable)
	if err != nil {
		return failure(args, version, err, os.Stdout, os.Stderr)
	}
	temp, err := os.MkdirTemp("", "image-to-jpg-cli-")
	if err != nil {
		return failure(args, version, err, os.Stdout, os.Stderr)
	}
	defer os.RemoveAll(temp)
	marker := filepath.Join(temp, "cancel")
	cmd := exec.Command(node, append([]string{cli}, args...)...)
	cmd.Env = environment(marker)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	configureCommand(cmd)
	signals, done := make(chan os.Signal, 4), make(chan struct{})
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	if err := cmd.Start(); err != nil {
		return failure(args, version, err, os.Stdout, os.Stderr)
	}
	go func() {
		for {
			select {
			case value := <-signals:
				message := "SIGINT"
				if value == syscall.SIGTERM {
					message = "SIGTERM"
				}
				_ = os.WriteFile(marker, []byte(message), 0600)
			case <-done:
				return
			}
		}
	}()
	err = cmd.Wait()
	close(done)
	if err == nil {
		return 0
	}
	if exit, ok := err.(*exec.ExitError); ok {
		if code := exit.ExitCode(); code >= 0 {
			return code
		}
		fmt.Fprintln(os.Stderr, "CHILD_TERMINATED:", err)
		return 1
	}
	return failure(args, version, err, os.Stdout, os.Stderr)
}
