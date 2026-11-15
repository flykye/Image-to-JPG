package main

import (
	"image-to-jpg/internal/cliapp"
	"os"
)

var version = "development"

func main() { os.Exit(cliapp.Run(os.Args[1:], version)) }
