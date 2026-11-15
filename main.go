package main

import (
	"log"
	"runtime"

	"github.com/egoist/mygo"
)

func main() {
	desktop := &Desktop{}
	mygo.Bind(desktop)
	createWindow := func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title: "Image to JPG", URL: "/", Width: 1080, Height: 780,
			MinWidth: 760, MinHeight: 600,
			TitleBarStyle: mygo.TitleBarHiddenInset, TitleBarHeight: 44,
		})
	}
	mygo.App.WhenReady(createWindow)
	if runtime.GOOS == "darwin" {
		mygo.App.OnWindowAllClosed(func() {})
		mygo.App.OnActivate(func(visible bool) {
			if !visible {
				createWindow()
			}
		})
	}
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
