//go:build !windows

package cliapp

import "os/exec"

func configureCommand(_ *exec.Cmd) {}
