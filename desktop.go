package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

var conversionProgress = mygo.NewEvent[ProgressEvent]("conversion-progress")

type Desktop struct {
	mu         sync.Mutex
	cancelFile string
}

type Directory struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type Dependencies struct {
	ImageMagick bool `json:"imageMagick"`
}

func (*Desktop) SelectDirectories(ctx context.Context) ([]Directory, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent: mygo.CallerWindow(ctx), Title: "选择包含图片的文件夹", Directory: true, Multiple: true,
	})
	if err != nil {
		return nil, err
	}
	return validateDirectories(paths)
}

func (*Desktop) ValidateDirectories(paths []string) ([]Directory, error) {
	return validateDirectories(paths)
}

func validateDirectories(paths []string) ([]Directory, error) {
	dirs := make([]Directory, 0, len(paths))
	seen := map[string]bool{}
	for _, input := range paths {
		if input == "" {
			return nil, errors.New("文件夹路径不能为空")
		}
		absolute, err := filepath.Abs(input)
		if err != nil {
			return nil, err
		}
		resolved, err := filepath.EvalSymlinks(absolute)
		if err != nil {
			return nil, fmt.Errorf("无法访问文件夹：%w", err)
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("请添加文件夹：%s", input)
		}
		if !seen[resolved] {
			dirs = append(dirs, Directory{Path: resolved, Name: filepath.Base(resolved)})
			seen[resolved] = true
		}
	}
	return dirs, nil
}

func (d *Desktop) Process(ctx context.Context, paths []string, settings Settings) (BatchResult, error) {
	d.mu.Lock()
	if d.cancelFile != "" {
		d.mu.Unlock()
		return BatchResult{}, errors.New("已有任务正在处理")
	}
	temp, err := os.MkdirTemp("", "image-to-jpg-job-")
	if err != nil {
		d.mu.Unlock()
		return BatchResult{}, err
	}
	marker := filepath.Join(temp, "cancel")
	d.cancelFile = marker
	d.mu.Unlock()
	defer func() {
		d.mu.Lock()
		d.cancelFile = ""
		d.mu.Unlock()
		os.RemoveAll(temp)
	}()
	if err := settings.validate(); err != nil {
		return BatchResult{}, err
	}
	dirs, err := validateDirectories(paths)
	if err != nil {
		return BatchResult{}, err
	}
	if len(dirs) == 0 {
		return BatchResult{}, errors.New("请选择文件夹")
	}
	normalized := make([]string, len(dirs))
	for i, dir := range dirs {
		normalized[i] = dir.Path
	}
	page := mygo.CallerPage(ctx)
	var result BatchResult
	err = runEngine(ctx, engineRequest{
		Action: "process", Paths: normalized, Options: settings, CancelFile: marker,
	}, func(event ProgressEvent) {
		if page != nil {
			_ = conversionProgress.EmitPage(page, event)
		}
	}, &result)
	return result, err
}

// Cancel finishes files already in flight, then stops before starting new ones.
func (d *Desktop) Cancel() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.cancelFile == "" {
		return nil
	}
	return os.WriteFile(d.cancelFile, nil, 0600)
}

func (*Desktop) CheckDependencies(ctx context.Context) (Dependencies, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var result Dependencies
	err := runEngine(ctx, engineRequest{Action: "dependencies"}, nil, &result)
	return result, err
}

func (*Desktop) OpenDirectory(path string) error {
	dirs, err := validateDirectories([]string{path})
	if err != nil {
		return err
	}
	return mygo.Shell.OpenPath(dirs[0].Path)
}

func (*Desktop) OpenImageMagickDownload() error {
	return mygo.Shell.OpenExternal("https://imagemagick.org/script/download.php")
}
