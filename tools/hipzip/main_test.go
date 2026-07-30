package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectArchiveReturnsDrawablePNGCountAndPrefix(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mrc")
	createTestZIP(t, source, map[string][]byte{
		"description.xml":                           []byte("<title>Test</title>"),
		"res/drawable-xxhdpi/com.example.one.png":   []byte("one"),
		"res/drawable-nodpi-v4/com.example.two.png": []byte("two"),
		"res/drawable-xxhdpi/readme.txt":            []byte("skip"),
		"assets/unrelated.png":                      []byte("skip"),
	})

	var output bytes.Buffer
	if err := inspectArchive(source, &output); err != nil {
		t.Fatal(err)
	}
	var index archiveIndex
	if err := json.Unmarshal(output.Bytes(), &index); err != nil {
		t.Fatal(err)
	}
	if index.Prefix != "res/drawable-nodpi-v4/" {
		t.Fatalf("unexpected prefix: %s", index.Prefix)
	}
	if index.EntryCount != 2 {
		t.Fatalf("entry count = %d, want 2", index.EntryCount)
	}
	if index.Size <= 0 {
		t.Fatal("source size missing")
	}
}

func TestPatchPreservesOriginalAndReplacesIcon(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mrc")
	output := filepath.Join(root, "output.mrc")
	icons := filepath.Join(root, "icons")
	if err := os.Mkdir(icons, 0700); err != nil {
		t.Fatal(err)
	}

	originalBody := bytes.Repeat([]byte("original-data-"), 100)
	createTestZIP(t, source, map[string][]byte{
		"description.xml":                               []byte("<title>Test</title>"),
		"res/drawable-xxhdpi/com.example.app.png":       []byte("old"),
		"res/drawable-xxhdpi/com.example.untouched.png": originalBody,
	})
	icon := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{1, 2, 3, 4}, 40)...)
	if err := os.WriteFile(filepath.Join(icons, "com.example.app.png"), icon, 0600); err != nil {
		t.Fatal(err)
	}

	beforeRaw := rawEntry(t, source, "res/drawable-xxhdpi/com.example.untouched.png")
	if err := patch(source, output, icons, "res/drawable-xxhdpi/"); err != nil {
		t.Fatal(err)
	}
	afterRaw := rawEntry(t, output, "res/drawable-xxhdpi/com.example.untouched.png")
	if !bytes.Equal(beforeRaw, afterRaw) {
		t.Fatal("untouched compressed data changed")
	}
	if got := readEntry(t, output, "res/drawable-xxhdpi/com.example.app.png"); !bytes.Equal(got, icon) {
		t.Fatal("replacement icon mismatch")
	}
	if method := entryMethod(t, output, "res/drawable-xxhdpi/com.example.app.png"); method != zip.Store {
		t.Fatalf("replacement icon uses ZIP method %d, want Store", method)
	}
	sourceBytes, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	outputBytes, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	centralOffset, _, _, err := parseCentralDirectory(sourceBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(sourceBytes[:centralOffset], outputBytes[:centralOffset]) {
		t.Fatal("source local-file region was rewritten instead of being preserved byte-for-byte")
	}
}

func TestPatchReplacesExistingIconInItsActualDrawableDirectory(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.mrc")
	output := filepath.Join(root, "output.mrc")
	icons := filepath.Join(root, "icons")
	if err := os.Mkdir(icons, 0700); err != nil {
		t.Fatal(err)
	}

	createTestZIP(t, source, map[string][]byte{
		"res/drawable-xxhdpi/unrelated.png":              []byte("unrelated"),
		"res/drawable-nodpi-v4/com.example.existing.png": []byte("old-icon"),
		"res/drawable-nodpi-v4/com.example.other.png":    []byte("other"),
	})
	icon := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{9, 8, 7, 6}, 40)...)
	if err := os.WriteFile(filepath.Join(icons, "com.example.existing.png"), icon, 0600); err != nil {
		t.Fatal(err)
	}

	if err := patch(source, output, icons, "res/drawable-xxhdpi/"); err != nil {
		t.Fatal(err)
	}
	if got := readEntry(t, output, "res/drawable-nodpi-v4/com.example.existing.png"); !bytes.Equal(got, icon) {
		t.Fatal("existing icon was not replaced in its actual drawable directory")
	}
	if hasEntry(t, output, "res/drawable-xxhdpi/com.example.existing.png") {
		t.Fatal("existing icon was duplicated into the fallback directory")
	}
}

func TestRebuildFromCleanBaseRestoresDeletedRecipeAndKeepsRemaining(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "clean-base.mrc")
	output := filepath.Join(root, "output.mrc")
	icons := filepath.Join(root, "remaining-icons")
	if err := os.Mkdir(icons, 0700); err != nil {
		t.Fatal(err)
	}

	restoredOriginal := []byte("theme-original")
	remainingOriginal := []byte("theme-old")
	createTestZIP(t, source, map[string][]byte{
		"res/drawable-xxhdpi/com.example.restore.png": restoredOriginal,
		"res/drawable-xxhdpi/com.example.keep.png":    remainingOriginal,
	})
	remainingCustom := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{4, 3, 2, 1}, 40)...)
	if err := os.WriteFile(filepath.Join(icons, "com.example.keep.png"), remainingCustom, 0600); err != nil {
		t.Fatal(err)
	}

	if err := patch(source, output, icons, "res/drawable-xxhdpi/"); err != nil {
		t.Fatal(err)
	}
	if got := readEntry(t, output, "res/drawable-xxhdpi/com.example.restore.png"); !bytes.Equal(got, restoredOriginal) {
		t.Fatal("deleted replacement was not restored from the clean theme base")
	}
	if got := readEntry(t, output, "res/drawable-xxhdpi/com.example.keep.png"); !bytes.Equal(got, remainingCustom) {
		t.Fatal("remaining custom recipe was not reapplied")
	}
	if hasEntry(t, output, "res/drawable-xxhdpi/com.example.added.png") {
		t.Fatal("deleted added icon should not exist in rebuilt output")
	}
}

func TestMissingOnlyKeepsThemeIconsAndAddsUnadaptedIcons(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "updated-theme.mrc")
	output := filepath.Join(root, "merged.mrc")
	icons := filepath.Join(root, "saved-icons")
	if err := os.Mkdir(icons, 0700); err != nil {
		t.Fatal(err)
	}

	themeIcon := []byte("new-theme-icon")
	createTestZIP(t, source, map[string][]byte{
		"res/drawable-xxhdpi/com.example.theme.png": themeIcon,
		"res/drawable-xxhdpi/unrelated.png":         []byte("unrelated"),
	})
	customThemeIcon := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{1}, 40)...)
	customMissingIcon := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{2}, 40)...)
	if err := os.WriteFile(filepath.Join(icons, "com.example.theme.png"), customThemeIcon, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(icons, "com.example.missing.png"), customMissingIcon, 0600); err != nil {
		t.Fatal(err)
	}

	if err := patchWithOptions(source, output, icons, "", true); err != nil {
		t.Fatal(err)
	}
	if got := readEntry(t, output, "res/drawable-xxhdpi/com.example.theme.png"); !bytes.Equal(got, themeIcon) {
		t.Fatal("missing-only merge overwrote an icon supplied by the updated theme")
	}
	if got := readEntry(t, output, "res/drawable-xxhdpi/com.example.missing.png"); !bytes.Equal(got, customMissingIcon) {
		t.Fatal("missing-only merge did not add an unadapted custom icon")
	}
}

func TestMissingOnlySkipsOutputWhenNothingIsMissing(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "theme.mrc")
	output := filepath.Join(root, "should-not-exist.mrc")
	icons := filepath.Join(root, "saved-icons")
	if err := os.Mkdir(icons, 0700); err != nil {
		t.Fatal(err)
	}
	createTestZIP(t, source, map[string][]byte{
		"res/drawable-xxhdpi/com.example.present.png": []byte("theme-icon"),
	})
	custom := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{8}, 40)...)
	if err := os.WriteFile(filepath.Join(icons, "com.example.present.png"), custom, 0600); err != nil {
		t.Fatal(err)
	}

	if err := patchWithOptions(source, output, icons, "", true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("missing-only merge created an output archive even though no entries were missing")
	}
}

func TestPatchRejectsUnsafePrefix(t *testing.T) {
	if err := patch("unused", "unused", "unused", "../drawable"); err == nil {
		t.Fatal("unsafe prefix was accepted")
	}
}

func TestLoadIconsRejectsExcessiveCount(t *testing.T) {
	dir := t.TempDir()
	icon := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, byte(1))
	for index := 0; index <= maxIconCount; index++ {
		name := filepath.Join(dir, fmt.Sprintf("com.example.app%d.png", index))
		if err := os.WriteFile(name, icon, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := loadIcons(dir); err == nil {
		t.Fatal("excessive icon count was accepted")
	}
}

func TestValidPackageRejectsUnsafeOrOversizedNames(t *testing.T) {
	for _, value := range []string{"", ".hidden", "-option", "com/example/app", strings.Repeat("a", 256)} {
		if validPackage(value) {
			t.Fatalf("invalid package accepted: %q", value)
		}
	}
	if !validPackage("com.example_valid-app") {
		t.Fatal("valid package was rejected")
	}
}

func hasEntry(t *testing.T, filename, name string) bool {
	t.Helper()
	reader, err := zip.OpenReader(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if entry.Name == name {
			return true
		}
	}
	return false
}

func entryMethod(t *testing.T, filename, name string) uint16 {
	t.Helper()
	reader, err := zip.OpenReader(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if entry.Name == name {
			return entry.Method
		}
	}
	t.Fatalf("entry not found: %s", name)
	return 0
}

func createTestZIP(t *testing.T, filename string, files map[string][]byte) {
	t.Helper()
	file, err := os.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for name, data := range files {
		target, createErr := writer.Create(name)
		if createErr != nil {
			t.Fatal(createErr)
		}
		if _, err = target.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
}

func rawEntry(t *testing.T, filename, name string) []byte {
	t.Helper()
	reader, err := zip.OpenReader(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if entry.Name == name {
			stream, openErr := entry.OpenRaw()
			if openErr != nil {
				t.Fatal(openErr)
			}
			data, readErr := io.ReadAll(stream)
			if readErr != nil {
				t.Fatal(readErr)
			}
			return data
		}
	}
	t.Fatalf("entry not found: %s", name)
	return nil
}

func readEntry(t *testing.T, filename, name string) []byte {
	t.Helper()
	reader, err := zip.OpenReader(filename)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if entry.Name == name {
			stream, openErr := entry.Open()
			if openErr != nil {
				t.Fatal(openErr)
			}
			defer stream.Close()
			data, readErr := io.ReadAll(stream)
			if readErr != nil {
				t.Fatal(readErr)
			}
			return data
		}
	}
	t.Fatalf("entry not found: %s", name)
	return nil
}
