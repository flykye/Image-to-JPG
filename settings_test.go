package main

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsRoundTripAndReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	settings := defaultSettings()
	if err := writeSettings(path, settings); err != nil {
		t.Fatal(err)
	}
	settings.Quality = 67
	settings.CompressJpg = false
	settings.CompressAboveMb = 12.5
	settings.ForceUnder20Mb = true
	settings.SkipExisting = true
	settings.Concurrency = 20
	if err := writeSettings(path, settings); err != nil {
		t.Fatal(err)
	}
	got, err := readSettings(path)
	if err != nil || got != settings {
		t.Fatalf("got %+v, %v", got, err)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatal("temporary settings files were left behind")
	}
}

func TestLegacySettingsKeepNewDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	os.WriteFile(path, []byte(`{"quality":85,"compressJpg":false}`), 0600)
	got, err := readSettings(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Quality != 85 || got.CompressJpg || got.Concurrency != 4 || got.SkipExisting || got.CompressAboveMb != 0 || got.ForceUnder20Mb {
		t.Fatalf("unexpected migrated settings: %+v", got)
	}
}

func TestRejectInvalidSettings(t *testing.T) {
	for _, settings := range []Settings{
		{Quality: 0, Concurrency: 1}, {Quality: 101, Concurrency: 1},
		{Quality: 90, Concurrency: 0}, {Quality: 90, Concurrency: 21},
		{Quality: 90, Concurrency: 1, CompressAboveMb: -1},
		{Quality: 90, Concurrency: 1, CompressAboveMb: 1000000.1},
		{Quality: 90, Concurrency: 1, CompressAboveMb: math.NaN()},
		{Quality: 90, Concurrency: 1, CompressAboveMb: math.Inf(1)},
		{Quality: 90, Concurrency: 1, CompressAboveMb: math.Inf(-1)},
	} {
		if settings.validate() == nil {
			t.Fatalf("accepted %+v", settings)
		}
	}
}

func TestThreadDefaultsAndSavedPreferences(t *testing.T) {
	if defaultSettings().Concurrency != 4 {
		t.Fatal("new installs must default to four threads")
	}
	for _, count := range []int{1, 2, 3, 4, 10, 20} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "settings.json")
			data := fmt.Sprintf(`{"quality":90,"concurrency":%d}`, count)
			if err := os.WriteFile(path, []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			got, err := readSettings(path)
			if err != nil || got.Concurrency != count {
				t.Fatalf("saved preference %d became %+v, %v", count, got, err)
			}
		})
	}
}

func TestAcceptValidCompressionThresholds(t *testing.T) {
	for _, threshold := range []float64{0, 0.5, 20, 1000000} {
		settings := defaultSettings()
		settings.CompressAboveMb = threshold
		if err := settings.validate(); err != nil {
			t.Fatalf("rejected %v MB: %v", threshold, err)
		}
	}
}

func TestDirectoryValidation(t *testing.T) {
	root := t.TempDir()
	dirs, err := validateDirectories([]string{root, root})
	if err != nil || len(dirs) != 1 {
		t.Fatalf("got %+v, %v", dirs, err)
	}
	file := filepath.Join(root, "file.png")
	os.WriteFile(file, []byte("test"), 0600)
	if _, err := validateDirectories([]string{file}); err == nil {
		t.Fatal("accepted a file")
	}
	if _, err := validateDirectories([]string{""}); err == nil {
		t.Fatal("accepted empty path")
	}
	if _, err := validateDirectories([]string{filepath.Join(root, "missing")}); err == nil {
		t.Fatal("accepted a missing directory")
	}
}
