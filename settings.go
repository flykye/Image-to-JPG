package main

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

type Settings struct {
	Quality         int     `json:"quality"`
	CompressJpg     bool    `json:"compressJpg"`
	CompressAboveMb float64 `json:"compressAboveMb"`
	ForceUnder20Mb  bool    `json:"forceUnder20Mb"`
	SkipExisting    bool    `json:"skipExisting"`
	Concurrency     int     `json:"concurrency"`
}

var settingsMu sync.Mutex

func defaultSettings() Settings {
	return Settings{Quality: 90, CompressJpg: true, Concurrency: 4}
}

func (s Settings) validate() error {
	if s.Quality < 1 || s.Quality > 100 {
		return errors.New("JPG 质量需为 1–100")
	}
	if s.Concurrency < 1 || s.Concurrency > 20 {
		return errors.New("处理线程数需为 1–20")
	}
	if math.IsNaN(s.CompressAboveMb) || math.IsInf(s.CompressAboveMb, 0) || s.CompressAboveMb < 0 || s.CompressAboveMb > 1000000 {
		return errors.New("JPG 压缩阈值需为 0–1,000,000 MB 的有效数值")
	}
	return nil
}

func settingsPath() (string, error) {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "settings.json"), nil
}

func readSettings(path string) (Settings, error) {
	settings := defaultSettings()
	data, err := os.ReadFile(path)
	if err != nil {
		return settings, err
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return settings, err
	}
	return settings, settings.validate()
}

func (*Desktop) GetSettings() (Settings, error) {
	settingsMu.Lock()
	defer settingsMu.Unlock()
	path, err := settingsPath()
	if err != nil {
		return Settings{}, err
	}
	settings, err := readSettings(path)
	if err == nil {
		return settings, nil
	}
	if !os.IsNotExist(err) {
		return Settings{}, err
	}
	// Migrate the former electron-store config without altering the old file.
	config, err := os.UserConfigDir()
	if err != nil {
		return defaultSettings(), nil
	}
	for _, name := range []string{"image-to-jpg", "Image to JPG"} {
		if old, err := readSettings(filepath.Join(config, name, "config.json")); err == nil {
			return old, nil
		}
	}
	return defaultSettings(), nil
}

func (*Desktop) SaveSettings(settings Settings) error {
	if err := settings.validate(); err != nil {
		return err
	}
	settingsMu.Lock()
	defer settingsMu.Unlock()
	path, err := settingsPath()
	if err != nil {
		return err
	}
	return writeSettings(path, settings)
}

func writeSettings(path string, settings Settings) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".settings-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
