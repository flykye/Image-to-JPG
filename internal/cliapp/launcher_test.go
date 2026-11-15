package cliapp

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMissingRuntimeHasMachineReadableError(t *testing.T) {
	for _, flag := range []string{"--json", "--jsonl"} {
		var output, diagnostic bytes.Buffer
		_, _, err := runtimePaths(filepath.Join(t.TempDir(), "missing"))
		if err == nil {
			t.Fatal("accepted missing runtime")
		}
		code := failure([]string{flag}, "1.3.0", err, &output, &diagnostic)
		var decoded map[string]any
		if code != 2 || json.Unmarshal(output.Bytes(), &decoded) != nil {
			t.Fatal("invalid environment result")
		}
		if flag == "--jsonl" {
			decoded = decoded["result"].(map[string]any)
		}
		if decoded["schemaVersion"] != float64(1) || decoded["error"].(map[string]any)["code"] != "ENVIRONMENT_ERROR" {
			t.Fatal(decoded)
		}
		if !strings.Contains(diagnostic.String(), "ENVIRONMENT_ERROR") {
			t.Fatal("no diagnostic")
		}
	}
}

func TestRuntimeIsResolvedBesideExecutable(t *testing.T) {
	root := t.TempDir()
	exe := filepath.Join(root, "batch-image-processor")
	node := filepath.Join(root, "bin", "node")
	if runtime.GOOS == "windows" {
		exe += ".exe"
		node += ".exe"
	}
	cli := filepath.Join(root, "engine", "src", "cli", "index.js")
	for _, name := range []string{exe, node, cli} {
		os.MkdirAll(filepath.Dir(name), 0755)
		os.WriteFile(name, []byte("test"), 0755)
	}
	gotNode, gotCLI, err := runtimePaths(exe)
	wantNode, nodeErr := filepath.EvalSymlinks(node)
	wantCLI, cliErr := filepath.EvalSymlinks(cli)
	if err != nil || nodeErr != nil || cliErr != nil || gotNode != wantNode || gotCLI != wantCLI {
		t.Fatalf("%s %s %v", gotNode, gotCLI, err)
	}
	os.Remove(cli)
	if _, _, err := runtimePaths(exe); err == nil {
		t.Fatal("accepted missing CLI source")
	}
}

func TestNodeEnvironmentIsIsolated(t *testing.T) {
	t.Setenv("NODE_OPTIONS", "--invalid-option")
	t.Setenv("NODE_PATH", "/untrusted")
	t.Setenv("IMAGE_TO_JPG_CANCEL_FILE", "/untrusted-cancel")
	env := strings.Join(environment("owned-cancel"), "\n")
	if strings.Contains(env, "NODE_OPTIONS=") || strings.Contains(env, "NODE_PATH=") || strings.Contains(env, "/untrusted-cancel") {
		t.Fatal("inherited runtime overrides")
	}
	if !strings.Contains(env, "IMAGE_TO_JPG_CANCEL_FILE=owned-cancel") {
		t.Fatal("missing owned marker")
	}
}

func TestProtocolDetectionHonorsEndOfOptions(t *testing.T) {
	if mode([]string{"--", "--json"}) != "" || mode([]string{"--json", "--", "folder"}) != "json" {
		t.Fatal("incorrect option boundary")
	}
}
