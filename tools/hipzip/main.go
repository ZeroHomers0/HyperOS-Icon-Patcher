package main

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"time"
)

const (
	maxSourceSize = 80 * 1024 * 1024
	maxIconSize   = 50 * 1024
	maxIconCount  = 500
)

type iconFile struct {
	name string
	data []byte
}

func main() {
	source := flag.String("source", "", "source ZIP/MRC")
	output := flag.String("output", "", "output ZIP/MRC")
	icons := flag.String("icons", "", "directory containing package-name PNG files")
	prefix := flag.String("prefix", "", "ZIP drawable directory")
	missingOnly := flag.Bool("missing-only", false, "only add icons missing from the source")
	inspect := flag.Bool("inspect", false, "print drawable entry index as JSON")
	flag.Parse()

	if *inspect {
		if err := inspectArchive(*source, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, "ERROR:"+err.Error())
			os.Exit(1)
		}
		return
	}
	if err := patchWithOptions(*source, *output, *icons, *prefix, *missingOnly); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:"+err.Error())
		os.Exit(1)
	}
}

type archiveIndex struct {
	Prefix     string `json:"prefix"`
	EntryCount int    `json:"entryCount"`
	Size       int64  `json:"size"`
}

func inspectArchive(source string, output io.Writer) error {
	if source == "" {
		return errors.New("missing source path")
	}
	info, err := os.Stat(source)
	if err != nil {
		return fmt.Errorf("source unavailable: %w", err)
	}
	if info.Size() <= 0 || info.Size() > maxSourceSize {
		return errors.New("source size is invalid")
	}
	reader, err := zip.OpenReader(source)
	if err != nil {
		return fmt.Errorf("source ZIP is invalid: %w", err)
	}
	defer reader.Close()
	entryCount := 0
	for _, entry := range reader.File {
		if !safeEntryName(entry.Name) {
			return fmt.Errorf("unsafe ZIP entry: %q", entry.Name)
		}
		dir, name := path.Split(entry.Name)
		if isDrawableDirectory(dir) && strings.HasSuffix(strings.ToLower(name), ".png") {
			entryCount++
		}
	}
	return json.NewEncoder(output).Encode(archiveIndex{
		Prefix:     preferredDrawablePrefix(reader.File),
		EntryCount: entryCount,
		Size:       info.Size(),
	})
}

func patch(source, output, iconsDir, prefix string) (err error) {
	return patchWithOptions(source, output, iconsDir, prefix, false)
}

func patchWithOptions(source, output, iconsDir, prefix string, missingOnly bool) (err error) {
	if source == "" || output == "" || iconsDir == "" {
		return errors.New("missing required path")
	}

	sourceInfo, err := os.Stat(source)
	if err != nil {
		return fmt.Errorf("source unavailable: %w", err)
	}
	if sourceInfo.Size() <= 0 || sourceInfo.Size() > maxSourceSize {
		return errors.New("source size is invalid")
	}

	icons, err := loadIcons(iconsDir)
	if err != nil {
		return err
	}

	reader, err := zip.OpenReader(source)
	if err != nil {
		return fmt.Errorf("source ZIP is invalid: %w", err)
	}
	defer reader.Close()

	if prefix == "" {
		prefix = preferredDrawablePrefix(reader.File)
	} else {
		prefix, err = safePrefix(prefix)
		if err != nil {
			return err
		}
	}
	replaced := replacementTargets(reader.File, icons, prefix, missingOnly)

	for _, entry := range reader.File {
		if !safeEntryName(entry.Name) {
			return fmt.Errorf("unsafe ZIP entry: %q", entry.Name)
		}
	}
	if len(replaced) == 0 {
		fmt.Printf("OK:%d:0:%d\n", len(icons), sourceInfo.Size())
		return nil
	}

	if err = writePreservingArchive(source, output, replaced); err != nil {
		return err
	}

	if err = verify(output, replaced); err != nil {
		_ = os.Remove(output)
		return err
	}
	fmt.Printf("OK:%d:%d:%d\n", len(icons), len(replaced), sourceInfo.Size())
	return nil
}

type centralRecord struct {
	name string
	raw  []byte
}

func writePreservingArchive(source, output string, replacements map[string]iconFile) (err error) {
	data, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("cannot read source archive: %w", err)
	}
	centralOffset, records, comment, err := parseCentralDirectory(data)
	if err != nil {
		return err
	}

	retained := make([]centralRecord, 0, len(records)+len(replacements))
	for _, record := range records {
		if _, replace := replacements[record.name]; !replace {
			retained = append(retained, record)
		}
	}

	names := make([]string, 0, len(replacements))
	for name := range replacements {
		names = append(names, name)
	}
	sort.Strings(names)

	out, err := os.OpenFile(output, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("cannot create output: %w", err)
	}
	complete := false
	defer func() {
		closeErr := out.Close()
		if err == nil && closeErr != nil {
			err = closeErr
		}
		if !complete {
			_ = os.Remove(output)
		}
	}()

	// Stream the output instead of building a second archive-sized byte buffer.
	// The source still stays in memory for central-directory parsing, but peak RAM
	// is reduced by roughly one full MRC on memory-constrained Android devices.
	currentOffset := 0
	writeChunk := func(chunk []byte) error {
		written, writeErr := out.Write(chunk)
		currentOffset += written
		if writeErr != nil {
			return writeErr
		}
		if written != len(chunk) {
			return io.ErrShortWrite
		}
		return nil
	}
	if err = writeChunk(data[:centralOffset]); err != nil {
		return fmt.Errorf("cannot preserve source entries: %w", err)
	}

	now := time.Now()
	for _, name := range names {
		icon := replacements[name]
		local, central, buildErr := buildStoredEntry(name, icon.data, currentOffset, now)
		if buildErr != nil {
			return buildErr
		}
		if err = writeChunk(local); err != nil {
			return fmt.Errorf("cannot write replacement %q: %w", name, err)
		}
		retained = append(retained, centralRecord{name: name, raw: central})
	}

	newCentralOffset := currentOffset
	for _, record := range retained {
		if err = writeChunk(record.raw); err != nil {
			return fmt.Errorf("cannot write central directory: %w", err)
		}
	}
	centralSize := currentOffset - newCentralOffset
	if len(retained) > 65535 || newCentralOffset > int(^uint32(0)) || centralSize > int(^uint32(0)) {
		return errors.New("ZIP64 output is not supported")
	}
	eocd := make([]byte, 22+len(comment))
	binary.LittleEndian.PutUint32(eocd[0:4], 0x06054b50)
	binary.LittleEndian.PutUint16(eocd[8:10], uint16(len(retained)))
	binary.LittleEndian.PutUint16(eocd[10:12], uint16(len(retained)))
	binary.LittleEndian.PutUint32(eocd[12:16], uint32(centralSize))
	binary.LittleEndian.PutUint32(eocd[16:20], uint32(newCentralOffset))
	binary.LittleEndian.PutUint16(eocd[20:22], uint16(len(comment)))
	copy(eocd[22:], comment)
	if err = writeChunk(eocd); err != nil {
		return fmt.Errorf("cannot write ZIP end record: %w", err)
	}
	if currentOffset > maxSourceSize {
		return errors.New("output archive exceeds 80MB limit")
	}
	if err = out.Sync(); err != nil {
		return fmt.Errorf("cannot sync output: %w", err)
	}
	complete = true
	return nil
}

func parseCentralDirectory(data []byte) (int, []centralRecord, []byte, error) {
	eocd := -1
	start := len(data) - 22
	if start < 0 {
		return 0, nil, nil, errors.New("source ZIP is truncated")
	}
	limit := start - 65535
	if limit < 0 {
		limit = 0
	}
	for index := start; index >= limit; index-- {
		if binary.LittleEndian.Uint32(data[index:index+4]) == 0x06054b50 {
			eocd = index
			break
		}
	}
	if eocd < 0 {
		return 0, nil, nil, errors.New("source ZIP end record is missing")
	}
	count := int(binary.LittleEndian.Uint16(data[eocd+10 : eocd+12]))
	offset := int(binary.LittleEndian.Uint32(data[eocd+16 : eocd+20]))
	commentLength := int(binary.LittleEndian.Uint16(data[eocd+20 : eocd+22]))
	if eocd+22+commentLength > len(data) || offset < 0 || offset > eocd {
		return 0, nil, nil, errors.New("source ZIP end record is invalid")
	}
	records := make([]centralRecord, 0, count)
	cursor := offset
	for index := 0; index < count; index++ {
		if cursor+46 > eocd || binary.LittleEndian.Uint32(data[cursor:cursor+4]) != 0x02014b50 {
			return 0, nil, nil, errors.New("source ZIP central directory is invalid")
		}
		nameLength := int(binary.LittleEndian.Uint16(data[cursor+28 : cursor+30]))
		extraLength := int(binary.LittleEndian.Uint16(data[cursor+30 : cursor+32]))
		recordCommentLength := int(binary.LittleEndian.Uint16(data[cursor+32 : cursor+34]))
		end := cursor + 46 + nameLength + extraLength + recordCommentLength
		if end > eocd {
			return 0, nil, nil, errors.New("source ZIP central record is truncated")
		}
		name := string(data[cursor+46 : cursor+46+nameLength])
		records = append(records, centralRecord{name: name, raw: append([]byte(nil), data[cursor:end]...)})
		cursor = end
	}
	return offset, records, append([]byte(nil), data[eocd+22:eocd+22+commentLength]...), nil
}

func buildStoredEntry(name string, data []byte, offset int, modified time.Time) ([]byte, []byte, error) {
	nameBytes := []byte(name)
	if len(nameBytes) > 65535 || offset > int(^uint32(0)) || len(data) > int(^uint32(0)) {
		return nil, nil, errors.New("replacement ZIP entry is too large")
	}
	dosTime, dosDate := dosTimestamp(modified)
	checksum := crc32.ChecksumIEEE(data)
	local := make([]byte, 30+len(nameBytes)+len(data))
	binary.LittleEndian.PutUint32(local[0:4], 0x04034b50)
	binary.LittleEndian.PutUint16(local[4:6], 20)
	binary.LittleEndian.PutUint16(local[6:8], 0x0800)
	binary.LittleEndian.PutUint16(local[10:12], dosTime)
	binary.LittleEndian.PutUint16(local[12:14], dosDate)
	binary.LittleEndian.PutUint32(local[14:18], checksum)
	binary.LittleEndian.PutUint32(local[18:22], uint32(len(data)))
	binary.LittleEndian.PutUint32(local[22:26], uint32(len(data)))
	binary.LittleEndian.PutUint16(local[26:28], uint16(len(nameBytes)))
	copy(local[30:], nameBytes)
	copy(local[30+len(nameBytes):], data)

	central := make([]byte, 46+len(nameBytes))
	binary.LittleEndian.PutUint32(central[0:4], 0x02014b50)
	binary.LittleEndian.PutUint16(central[4:6], 20)
	binary.LittleEndian.PutUint16(central[6:8], 20)
	binary.LittleEndian.PutUint16(central[8:10], 0x0800)
	binary.LittleEndian.PutUint16(central[12:14], dosTime)
	binary.LittleEndian.PutUint16(central[14:16], dosDate)
	binary.LittleEndian.PutUint32(central[16:20], checksum)
	binary.LittleEndian.PutUint32(central[20:24], uint32(len(data)))
	binary.LittleEndian.PutUint32(central[24:28], uint32(len(data)))
	binary.LittleEndian.PutUint16(central[28:30], uint16(len(nameBytes)))
	binary.LittleEndian.PutUint32(central[42:46], uint32(offset))
	copy(central[46:], nameBytes)
	return local, central, nil
}

func dosTimestamp(value time.Time) (uint16, uint16) {
	year := value.Year()
	if year < 1980 {
		year = 1980
	}
	return uint16(value.Hour()<<11 | value.Minute()<<5 | value.Second()/2),
		uint16((year-1980)<<9 | int(value.Month())<<5 | value.Day())
}

func loadIcons(dir string) ([]iconFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("cannot read icon stage: %w", err)
	}
	icons := make([]iconFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".png") {
			continue
		}
		base := strings.TrimSuffix(entry.Name(), path.Ext(entry.Name()))
		if !validPackage(base) {
			return nil, fmt.Errorf("invalid icon package name: %q", entry.Name())
		}
		data, readErr := os.ReadFile(path.Join(dir, entry.Name()))
		if readErr != nil {
			return nil, fmt.Errorf("cannot read %q: %w", entry.Name(), readErr)
		}
		if len(data) == 0 || len(data) > maxIconSize {
			return nil, fmt.Errorf("icon size is invalid: %q", entry.Name())
		}
		if !bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}) {
			return nil, fmt.Errorf("icon is not PNG: %q", entry.Name())
		}
		icons = append(icons, iconFile{name: entry.Name(), data: data})
		if len(icons) > maxIconCount {
			return nil, fmt.Errorf("icon count exceeds %d", maxIconCount)
		}
	}
	if len(icons) == 0 {
		return nil, errors.New("no staged PNG icons")
	}
	sort.Slice(icons, func(i, j int) bool { return icons[i].name < icons[j].name })
	return icons, nil
}

func replacementTargets(entries []*zip.File, icons []iconFile, fallbackPrefix string, missingOnly bool) map[string]iconFile {
	byName := make(map[string]iconFile, len(icons))
	for _, icon := range icons {
		byName[icon.name] = icon
	}
	targets := make(map[string]iconFile, len(icons))
	matched := make(map[string]bool, len(icons))
	for _, entry := range entries {
		dir, name := path.Split(entry.Name)
		icon, ok := byName[name]
		if !ok || !isDrawableDirectory(dir) {
			continue
		}
		matched[name] = true
		if !missingOnly {
			targets[entry.Name] = icon
		}
	}
	for _, icon := range icons {
		if !matched[icon.name] {
			targets[fallbackPrefix+icon.name] = icon
		}
	}
	return targets
}

func preferredDrawablePrefix(entries []*zip.File) string {
	directories := make([]string, 0)
	seen := make(map[string]bool)
	for _, entry := range entries {
		dir, _ := path.Split(entry.Name)
		if !isDrawableDirectory(dir) || seen[dir] {
			continue
		}
		seen[dir] = true
		directories = append(directories, dir)
	}
	preferences := []string{"drawable-nodpi-v4", "drawable-nodpi", "drawable-xxhdpi", "drawable-xhdpi"}
	for _, preference := range preferences {
		for _, dir := range directories {
			if strings.Contains(dir, "/"+preference+"/") || strings.HasSuffix(dir, "/"+preference+"/") {
				return dir
			}
		}
	}
	if len(directories) > 0 {
		return directories[0]
	}
	return "res/drawable-xxhdpi/"
}

func isDrawableDirectory(dir string) bool {
	parts := strings.Split(strings.Trim(dir, "/"), "/")
	for index := 1; index < len(parts); index++ {
		if parts[index-1] == "res" && strings.HasPrefix(parts[index], "drawable") {
			return true
		}
	}
	return false
}

func verify(output string, expectedTargets map[string]iconFile) error {
	reader, err := zip.OpenReader(output)
	if err != nil {
		return fmt.Errorf("generated ZIP is invalid: %w", err)
	}
	defer reader.Close()

	expected := make(map[string][]byte, len(expectedTargets))
	for name, icon := range expectedTargets {
		expected[name] = icon.data
	}
	found := make(map[string]bool, len(expected))
	for _, entry := range reader.File {
		want, ok := expected[entry.Name]
		if !ok {
			continue
		}
		stream, openErr := entry.Open()
		if openErr != nil {
			return fmt.Errorf("cannot verify %q: %w", entry.Name, openErr)
		}
		got, readErr := io.ReadAll(io.LimitReader(stream, maxIconSize+1))
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil {
			return fmt.Errorf("cannot verify %q", entry.Name)
		}
		if !bytes.Equal(got, want) {
			return fmt.Errorf("verification mismatch: %q", entry.Name)
		}
		found[entry.Name] = true
	}
	if len(found) != len(expected) {
		return errors.New("not all icons were written")
	}
	return nil
}

func safePrefix(value string) (string, error) {
	value = strings.ReplaceAll(value, "\\", "/")
	if value == "" || strings.HasPrefix(value, "/") || strings.Contains(value, "..") {
		return "", errors.New("unsafe drawable prefix")
	}
	clean := path.Clean(value)
	if clean == "." || clean != strings.TrimSuffix(value, "/") {
		return "", errors.New("invalid drawable prefix")
	}
	return clean + "/", nil
}

func safeEntryName(name string) bool {
	if name == "" || strings.Contains(name, "\\") || strings.HasPrefix(name, "/") {
		return false
	}
	clean := path.Clean(name)
	return clean != "." && clean != ".." && !strings.HasPrefix(clean, "../")
}

func validPackage(value string) bool {
	if value == "" || len(value) > 255 || value[0] == '.' || value[0] == '-' {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '.' || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}
