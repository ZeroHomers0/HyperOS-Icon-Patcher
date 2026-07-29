package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var roots = []string{
	"module.prop",
	"customize.sh",
	"uninstall.sh",
	"README.md",
	"CHANGELOG.md",
	"THIRD_PARTY_NOTICES.md",
	"update.json",
	"bin",
	"scripts",
	"webroot",
}

func main() {
	if len(os.Args) != 3 {
		fatal(errors.New("usage: pack-module REPOSITORY OUTPUT.zip"))
	}
	repository, err := filepath.Abs(os.Args[1])
	if err != nil {
		fatal(err)
	}
	output, err := filepath.Abs(os.Args[2])
	if err != nil {
		fatal(err)
	}
	if err = pack(repository, output); err != nil {
		fatal(err)
	}
}

func pack(repository, output string) (err error) {
	if _, err = os.Stat(output); err == nil {
		return fmt.Errorf("output already exists: %s", output)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	files := make([]string, 0)
	for _, root := range roots {
		source := filepath.Join(repository, root)
		info, statErr := os.Stat(source)
		if statErr != nil {
			return fmt.Errorf("required path unavailable: %s: %w", root, statErr)
		}
		if !info.IsDir() {
			files = append(files, root)
			continue
		}
		walkErr := filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return nil
			}
			relative, relativeErr := filepath.Rel(repository, path)
			if relativeErr != nil {
				return relativeErr
			}
			files = append(files, filepath.ToSlash(relative))
			return nil
		})
		if walkErr != nil {
			return walkErr
		}
	}
	sort.Strings(files)

	target, err := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	complete := false
	defer func() {
		closeErr := target.Close()
		if err == nil && closeErr != nil {
			err = closeErr
		}
		if !complete {
			_ = os.Remove(output)
		}
	}()

	writer := zip.NewWriter(target)
	for _, name := range files {
		if strings.Contains(name, `\`) || strings.HasPrefix(name, "/") || strings.Contains(name, "..") {
			return fmt.Errorf("unsafe archive path: %s", name)
		}
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(0644)
		entry, createErr := writer.CreateHeader(header)
		if createErr != nil {
			return createErr
		}
		source, openErr := os.Open(filepath.Join(repository, filepath.FromSlash(name)))
		if openErr != nil {
			return openErr
		}
		_, copyErr := io.Copy(entry, source)
		closeErr := source.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if err = writer.Close(); err != nil {
		return err
	}
	if err = target.Sync(); err != nil {
		return err
	}
	complete = true
	return nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "ERROR:", err)
	os.Exit(1)
}
