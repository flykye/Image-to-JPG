package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Run the test executable as a child to exercise actual process IO and exits.
func TestEngineChild(t *testing.T) {
	mode := os.Getenv("IMAGE_JPG_TEST_CHILD")
	if mode == "" {
		return
	}
	switch mode {
	case "ok":
		fmt.Println(`{"type":"start","totalStats":{"total":4}}`)
		fmt.Println(`{"type":"result","result":{"totalFiles":4}}`)
	case "missing":
	case "invalid":
		fmt.Println("not-json")
	case "fatal":
		fmt.Println(`{"type":"fatal-error","error":"converter crashed"}`)
	case "exit":
		fmt.Fprintln(os.Stderr, "native library missing")
		os.Exit(2)
	case "wait":
		time.Sleep(30 * time.Second)
	case "oversized":
		fmt.Print(strings.Repeat("x", 3<<20))
	}
	os.Exit(0)
}

func TestEngineProtocolAndEarlyExits(t *testing.T) {
	for _, test := range []struct{ mode, wantError string }{
		{"ok", ""}, {"missing", "未返回结果"}, {"invalid", "无效消息"},
		{"fatal", "converter crashed"}, {"exit", "native library missing"}, {"oversized", "token too long"},
	} {
		t.Run(test.mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestEngineChild$")
			cmd.Env = append(os.Environ(), "IMAGE_JPG_TEST_CHILD="+test.mode)
			var result BatchResult
			events := 0
			err := executeEngine(ctx, cmd, func(event ProgressEvent) {
				if event.Type == "start" && event.TotalStats["total"] == 4 {
					events++
				}
			}, &result)
			if test.wantError == "" {
				if err != nil || result.TotalFiles != 4 || events != 1 {
					t.Fatalf("got %+v, %d events, %v", result, events, err)
				}
			} else if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("got %v, want error containing %s", err, test.wantError)
			}
		})
	}
}

func TestEngineContextCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestEngineChild$")
	cmd.Env = append(os.Environ(), "IMAGE_JPG_TEST_CHILD=wait")
	var result BatchResult
	if err := executeEngine(ctx, cmd, nil, &result); err != context.DeadlineExceeded {
		t.Fatalf("got %v", err)
	}
}
