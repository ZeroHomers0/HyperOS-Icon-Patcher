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

func TestCatalogThemesFiltersInstalledPackagesAndClassifiesRows(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.mrc")
	donor := filepath.Join(root, "donor.mrc")
	packages := filepath.Join(root, "packages.txt")
	createTestZIP(t, target, map[string][]byte{
		"res/drawable-xxhdpi/com.example.replace.png": testPNG(1),
	})
	createTestZIP(t, donor, map[string][]byte{
		"res/drawable-xxhdpi/com.example.replace.png": testPNG(2),
		"res/drawable-xxhdpi/com.example.add.png":     testPNG(3),
		"res/drawable-xxhdpi/com.example.hidden.png":  testPNG(4),
	})
	if err := os.WriteFile(packages, []byte("com.example.replace\ncom.example.add\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := catalogThemes(target, donor, packages, &output); err != nil {
		t.Fatal(err)
	}
	var catalog stitchCatalog
	if err := json.Unmarshal(output.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if catalog.TargetFingerprint == "" || catalog.SourceFingerprint == "" {
		t.Fatal("catalog fingerprints are missing")
	}
	if len(catalog.Rows) != 2 || catalog.Rows[0].PackageName != "com.example.add" || catalog.Rows[0].Kind != "add" || catalog.Rows[1].Kind != "replace" {
		t.Fatalf("unexpected catalog rows: %#v", catalog.Rows)
	}
}

func TestPreviewThemeIconUsesPreferredDrawable(t *testing.T) {
	root := t.TempDir()
	theme := filepath.Join(root, "theme.mrc")
	want := testPNG(7)
	createTestZIP(t, theme, map[string][]byte{
		"res/drawable-xhdpi/com.example.app.png":    testPNG(6),
		"res/drawable-nodpi-v4/com.example.app.png": want,
	})
	var output bytes.Buffer
	if err := previewThemeIcon(theme, "com.example.app", &output); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(output.Bytes(), want) {
		t.Fatal("preview did not use the preferred drawable entry")
	}
}

func TestStitchThemesAddsAndReplacesWithMatchingDensity(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.mrc")
	donor := filepath.Join(root, "donor.mrc")
	selection := filepath.Join(root, "selection.txt")
	output := filepath.Join(root, "output.mrc")
	targetUntouched := bytes.Repeat([]byte("untouched"), 20)
	donorXX := testPNG(8)
	donorNoDPI := testPNG(9)
	donorAdd := testPNG(10)
	createTestZIP(t, target, map[string][]byte{
		"description.xml": []byte("target"),
		"res/drawable-xxhdpi/com.example.replace.png":   testPNG(1),
		"res/drawable-nodpi-v4/com.example.replace.png": testPNG(2),
		"res/drawable-xxhdpi/com.example.untouched.png": targetUntouched,
	})
	createTestZIP(t, donor, map[string][]byte{
		"description.xml": []byte("donor"),
		"res/drawable-xxhdpi/com.example.replace.png":   donorXX,
		"res/drawable-nodpi-v4/com.example.replace.png": donorNoDPI,
		"res/drawable-nodpi-v4/com.example.add.png":     donorAdd,
	})
	if err := os.WriteFile(selection, []byte("com.example.replace\ncom.example.add\n"), 0600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(donor)
	if err != nil {
		t.Fatal(err)
	}
	result, err := stitchThemes(target, donor, selection, output)
	if err != nil {
		t.Fatal(err)
	}
	if result.Selected != 2 || result.Added != 1 || result.Replaced != 1 {
		t.Fatalf("unexpected stitch result: %#v", result)
	}
	if got := readEntry(t, output, "res/drawable-xxhdpi/com.example.replace.png"); !bytes.Equal(got, donorXX) {
		t.Fatal("xxhdpi target did not use matching donor density")
	}
	if got := readEntry(t, output, "res/drawable-nodpi-v4/com.example.replace.png"); !bytes.Equal(got, donorNoDPI) {
		t.Fatal("nodpi target did not use matching donor density")
	}
	if got := readEntry(t, output, "res/drawable-nodpi-v4/com.example.add.png"); !bytes.Equal(got, donorAdd) {
		t.Fatal("missing icon was not added to the target preferred directory")
	}
	if got := readEntry(t, output, "res/drawable-xxhdpi/com.example.untouched.png"); !bytes.Equal(got, targetUntouched) {
		t.Fatal("untouched target entry changed")
	}
	after, err := os.ReadFile(donor)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("donor theme was modified")
	}
}

func TestStitchThemesRejectsSameThemeAndEmptySelection(t *testing.T) {
	root := t.TempDir()
	theme := filepath.Join(root, "theme.mrc")
	selection := filepath.Join(root, "selection.txt")
	createTestZIP(t, theme, map[string][]byte{
		"res/drawable-xxhdpi/com.example.app.png": testPNG(1),
	})
	if err := os.WriteFile(selection, []byte("com.example.app\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := stitchThemes(theme, theme, selection, filepath.Join(root, "same.mrc")); err == nil {
		t.Fatal("same target and donor theme was accepted")
	}
	empty := filepath.Join(root, "empty.txt")
	if err := os.WriteFile(empty, nil, 0600); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(root, "other.mrc")
	createTestZIP(t, other, map[string][]byte{
		"res/drawable-xxhdpi/com.example.app.png": testPNG(2),
	})
	if _, err := stitchThemes(theme, other, empty, filepath.Join(root, "empty.mrc")); err == nil {
		t.Fatal("empty stitch selection was accepted")
	}
}

func TestStitchThemesFallsBackToPreferredDonorDensity(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.mrc")
	donor := filepath.Join(root, "donor.mrc")
	selection := filepath.Join(root, "selection.txt")
	output := filepath.Join(root, "output.mrc")
	want := testPNG(12)
	createTestZIP(t, target, map[string][]byte{
		"res/drawable-xxxhdpi/com.example.app.png": testPNG(1),
	})
	createTestZIP(t, donor, map[string][]byte{
		"res/drawable-xhdpi/com.example.app.png":    testPNG(11),
		"res/drawable-nodpi-v4/com.example.app.png": want,
	})
	if err := os.WriteFile(selection, []byte("com.example.app\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := stitchThemes(target, donor, selection, output); err != nil {
		t.Fatal(err)
	}
	if got := readEntry(t, output, "res/drawable-xxxhdpi/com.example.app.png"); !bytes.Equal(got, want) {
		t.Fatal("stitch did not use the preferred donor icon when the target density was unavailable")
	}
}

func TestStitchThemesRejectsInvalidDonorPNG(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target.mrc")
	donor := filepath.Join(root, "donor.mrc")
	selection := filepath.Join(root, "selection.txt")
	createTestZIP(t, target, map[string][]byte{
		"res/drawable-xxhdpi/com.example.app.png": testPNG(1),
	})
	createTestZIP(t, donor, map[string][]byte{
		"res/drawable-xxhdpi/com.example.app.png": []byte("not-a-png"),
	})
	if err := os.WriteFile(selection, []byte("com.example.app\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := stitchThemes(target, donor, selection, filepath.Join(root, "output.mrc")); err == nil {
		t.Fatal("invalid donor PNG was accepted")
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

func testPNG(marker byte) []byte {
	return append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{marker}, 24)...)
}
