package orchestrator

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	dockertypes "github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/api/types/volume"
	dockerclient "github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/docker/go-connections/nat"
	"github.com/docker/go-units"
	"github.com/gluk-w/claworc/control-plane/internal/config"
	"github.com/gluk-w/claworc/control-plane/internal/database"
	"github.com/gluk-w/claworc/control-plane/internal/sshproxy"
	"github.com/gluk-w/claworc/control-plane/internal/utils"
)

const (
	labelManagedBy          = "claworc"
	networkName             = "claworc"
	browserMetricsTmpfsSize = 256 * 1024 * 1024
	imageLabelMode          = "io.claworc.image-mode"
	imageLabelOpenClawUser  = "io.claworc.openclaw-user"
	imageLabelOpenClawHome  = "io.claworc.openclaw-home"
)

var volumeSuffixes = []string{"homebrew", "home"}

type DockerOrchestrator struct {
	client          *dockerclient.Client
	available       bool
	InstanceFactory sshproxy.InstanceFactory
}

func (d *DockerOrchestrator) Initialize(ctx context.Context) error {
	var opts []dockerclient.Opt
	opts = append(opts, dockerclient.FromEnv)
	opts = append(opts, dockerclient.WithAPIVersionNegotiation())
	if config.Cfg.DockerHost != "" {
		opts = append(opts, dockerclient.WithHost(config.Cfg.DockerHost))
	}

	var err error
	d.client, err = dockerclient.NewClientWithOpts(opts...)
	if err != nil {
		return fmt.Errorf("docker client: %w", err)
	}

	_, err = d.client.Ping(ctx)
	if err != nil {
		return fmt.Errorf("docker ping: %w", err)
	}

	if err := d.ensureNetwork(ctx); err != nil {
		return fmt.Errorf("docker network: %w", err)
	}

	d.available = true
	log.Println("Docker daemon connected")
	return nil
}

func (d *DockerOrchestrator) ensureNetwork(ctx context.Context) error {
	_, err := d.client.NetworkInspect(ctx, networkName, network.InspectOptions{})
	if err == nil {
		return nil
	}
	_, err = d.client.NetworkCreate(ctx, networkName, network.CreateOptions{
		Driver: "bridge",
		Labels: map[string]string{"managed-by": labelManagedBy},
	})
	if err != nil {
		return fmt.Errorf("create network %s: %w", networkName, err)
	}
	log.Printf("Created Docker network: %s", networkName)
	return nil
}

func (d *DockerOrchestrator) IsAvailable(_ context.Context) bool {
	return d.available
}

func (d *DockerOrchestrator) BackendName() string {
	return "docker"
}

func (d *DockerOrchestrator) volumeName(name, suffix string) string {
	return fmt.Sprintf("claworc-%s-%s", name, suffix)
}

func parseCPUToNanoCPUs(cpuStr string) int64 {
	if strings.HasSuffix(cpuStr, "m") {
		val := cpuStr[:len(cpuStr)-1]
		var n int64
		fmt.Sscanf(val, "%d", &n)
		return n * 1_000_000
	}
	var f float64
	fmt.Sscanf(cpuStr, "%f", &f)
	return int64(f * 1_000_000_000)
}

func parseMemoryToBytes(memStr string) int64 {
	unitMap := map[string]int64{
		"Ki": 1024,
		"Mi": 1024 * 1024,
		"Gi": 1024 * 1024 * 1024,
		"Ti": 1024 * 1024 * 1024 * 1024,
		"K":  1000,
		"M":  1000 * 1000,
		"G":  1000 * 1000 * 1000,
		"T":  1000 * 1000 * 1000 * 1000,
	}
	for suffix, multiplier := range unitMap {
		if strings.HasSuffix(memStr, suffix) {
			val := memStr[:len(memStr)-len(suffix)]
			var n int64
			fmt.Sscanf(val, "%d", &n)
			return n * multiplier
		}
	}
	var n int64
	fmt.Sscanf(memStr, "%d", &n)
	return n
}

func (d *DockerOrchestrator) ensureImage(ctx context.Context, img string) error {
	// Check if image exists locally first
	_, _, err := d.client.ImageInspectWithRaw(ctx, img)
	if err == nil {
		log.Printf("Image %s found locally", img)
		return nil
	}

	// Image not found locally, try to pull
	log.Printf("Image %s not found locally, pulling...", img)
	reader, err := d.client.ImagePull(ctx, img, image.PullOptions{})
	if err != nil {
		return fmt.Errorf("pull image %s: %w", img, err)
	}
	defer reader.Close()
	io.Copy(io.Discard, reader)
	log.Printf("Image %s pulled successfully", img)
	return nil
}

func contractFromCreateParams(params CreateParams) ImageContract {
	return NormalizeImageContract(ImageContract{
		Mode:               params.ImageMode,
		OpenClawUser:       params.OpenClawUser,
		OpenClawHome:       params.OpenClawHome,
		BrowserMetricsPath: params.BrowserMetricsPath,
	})
}

func homeFromImageEnv(env []string) string {
	for _, entry := range env {
		if strings.HasPrefix(entry, "HOME=") {
			home := strings.TrimSpace(strings.TrimPrefix(entry, "HOME="))
			if home != "" && home != "/" {
				return home
			}
		}
	}
	return ""
}

func (d *DockerOrchestrator) ResolveImageContract(ctx context.Context, imageRef string) (ImageContract, error) {
	contract := ImageContract{}
	if strings.TrimSpace(imageRef) == "" {
		return NormalizeImageContract(contract), nil
	}

	if err := d.ensureImage(ctx, imageRef); err != nil {
		return NormalizeImageContract(contract), err
	}

	inspect, _, err := d.client.ImageInspectWithRaw(ctx, imageRef)
	if err != nil {
		return NormalizeImageContract(contract), fmt.Errorf("inspect image %s: %w", imageRef, err)
	}

	if inspect.Config != nil {
		labels := inspect.Config.Labels
		if labels != nil {
			contract.Mode = strings.TrimSpace(labels[imageLabelMode])
			contract.OpenClawUser = strings.TrimSpace(labels[imageLabelOpenClawUser])
			contract.OpenClawHome = strings.TrimSpace(labels[imageLabelOpenClawHome])
		}
		if contract.OpenClawHome == "" {
			contract.OpenClawHome = homeFromImageEnv(inspect.Config.Env)
		}
		if contract.OpenClawUser == "" {
			user := strings.TrimSpace(inspect.Config.User)
			if i := strings.Index(user, ":"); i >= 0 {
				user = user[:i]
			}
			if user != "" && user != "root" {
				contract.OpenClawUser = user
			}
		}
	}

	if contract.OpenClawHome != "" && contract.OpenClawUser == "" && strings.HasPrefix(contract.OpenClawHome, "/home/") {
		if user := path.Base(contract.OpenClawHome); user != "." && user != "/" && user != "home" && user != "" {
			contract.OpenClawUser = user
		}
	}

	return NormalizeImageContract(contract), nil
}

func defaultManagedImageRef() string {
	if val, err := database.GetSetting("default_container_image"); err == nil && strings.TrimSpace(val) != "" {
		return strings.TrimSpace(val)
	}
	return "glukw/openclaw-vnc-chromium:latest"
}

func imageRepository(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	if i := strings.Index(ref, "@"); i >= 0 {
		ref = ref[:i]
	}
	lastSlash := strings.LastIndex(ref, "/")
	lastColon := strings.LastIndex(ref, ":")
	if lastColon > lastSlash {
		return ref[:lastColon]
	}
	return ref
}

func managedImageRepoScore(repo, preferred string) int {
	repo = strings.TrimSpace(repo)
	preferred = strings.TrimSpace(preferred)
	switch {
	case repo == "" || repo == "<none>":
		return 0
	case preferred != "" && repo == preferred:
		return 3
	case repo == "openclaw-vnc-chromium", strings.HasSuffix(repo, "/openclaw-vnc-chromium"):
		return 2
	case strings.Contains(repo, "openclaw-vnc-chromium"):
		return 1
	default:
		return 0
	}
}

func (d *DockerOrchestrator) bestLocalManagedImage(ctx context.Context, preferredRepo string) string {
	images, err := d.client.ImageList(ctx, image.ListOptions{})
	if err != nil {
		log.Printf("Failed to list local images for archive import fallback: %v", err)
		return ""
	}

	var bestTag string
	var bestScore int
	var bestCreated int64

	for _, img := range images {
		for _, tag := range img.RepoTags {
			tag = strings.TrimSpace(tag)
			if tag == "" || tag == "<none>:<none>" {
				continue
			}
			score := managedImageRepoScore(imageRepository(tag), preferredRepo)
			if score == 0 {
				continue
			}
			if bestTag == "" || score > bestScore || (score == bestScore && img.Created > bestCreated) {
				bestTag = tag
				bestScore = score
				bestCreated = img.Created
			}
		}
	}

	return bestTag
}

func (d *DockerOrchestrator) resolveArchiveBaseImage(ctx context.Context, requested string) (string, ImageContract, []string, error) {
	requested = strings.TrimSpace(requested)
	if requested != "" {
		contract, err := d.ResolveImageContract(ctx, requested)
		return requested, contract, nil, err
	}

	preferred := defaultManagedImageRef()
	contract, err := d.ResolveImageContract(ctx, preferred)
	if err == nil {
		return preferred, contract, nil, nil
	}

	fallback := d.bestLocalManagedImage(ctx, imageRepository(preferred))
	if fallback == "" || fallback == preferred {
		return preferred, NormalizeImageContract(ImageContract{}), nil, err
	}

	log.Printf("Default managed image %s unavailable for archive import, falling back to local image %s: %v", preferred, fallback, err)
	fallbackContract, fallbackErr := d.ResolveImageContract(ctx, fallback)
	if fallbackErr != nil {
		return preferred, NormalizeImageContract(ImageContract{}), nil, err
	}

	notes := []string{
		fmt.Sprintf("Default managed image %q was unavailable on this server, so Claworc used local managed image %q instead.", preferred, fallback),
	}
	return fallback, fallbackContract, notes, nil
}

func sanitizeArchiveImageComponent(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "import"
	}
	value = regexp.MustCompile(`[^a-z0-9._-]+`).ReplaceAllString(value, "-")
	value = regexp.MustCompile(`-+`).ReplaceAllString(value, "-")
	value = strings.Trim(value, "-._")
	if value == "" {
		return "import"
	}
	if len(value) > 48 {
		value = strings.Trim(value[:48], "-._")
	}
	if value == "" {
		return "import"
	}
	return value
}

func archiveImageRef(displayName, archiveName string) string {
	base := displayName
	if strings.TrimSpace(base) == "" {
		base = archiveName
	}
	slug := sanitizeArchiveImageComponent(base)
	return fmt.Sprintf("claworc-import/%s:%s", slug, time.Now().UTC().Format("20060329-150405"))
}

func normalizeArchiveExportFormat(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", "zip":
		return "zip"
	case "tgz", "tar.gz":
		return "tgz"
	default:
		return ""
	}
}

func archiveExportRootName(displayName, instanceName string) string {
	base := displayName
	if strings.TrimSpace(base) == "" {
		base = instanceName
	}
	slug := sanitizeArchiveImageComponent(base)
	return fmt.Sprintf("%s-backup-%s", slug, time.Now().UTC().Format("20060329-150405"))
}

func archiveExportFilename(rootDir, format string) string {
	if format == "tgz" {
		return rootDir + ".tgz"
	}
	return rootDir + ".zip"
}

func safeArchivePath(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", nil
	}
	if strings.HasPrefix(name, "/") {
		return "", fmt.Errorf("absolute archive paths are not allowed")
	}
	cleaned := path.Clean("/" + strings.TrimPrefix(name, "./"))
	rel := strings.TrimPrefix(cleaned, "/")
	if rel == "." || rel == "" {
		return "", nil
	}
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return "", fmt.Errorf("archive path escapes destination: %s", name)
	}
	return rel, nil
}

func writeArchiveFile(target string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return err
	}
	if mode != 0 {
		if err := os.Chmod(target, mode); err != nil {
			return err
		}
	}
	return nil
}

func extractZipArchive(archivePath, dest string) error {
	info, err := os.Stat(archivePath)
	if err != nil {
		return err
	}
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	zr, err := zip.NewReader(file, info.Size())
	if err != nil {
		return fmt.Errorf("invalid zip archive: %w", err)
	}

	for _, f := range zr.File {
		rel, err := safeArchivePath(f.Name)
		if err != nil {
			return err
		}
		if rel == "" {
			continue
		}
		target := filepath.Join(dest, filepath.FromSlash(rel))
		mode := f.Mode()
		if mode&os.ModeSymlink != 0 {
			return fmt.Errorf("archive symlinks are not supported: %s", rel)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return err
		}
		if err := writeArchiveFile(target, data, mode.Perm()); err != nil {
			return err
		}
	}
	return nil
}

func extractTarStream(r io.Reader, dest string) error {
	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read tar archive: %w", err)
		}
		rel, err := safeArchivePath(hdr.Name)
		if err != nil {
			return err
		}
		if rel == "" {
			continue
		}
		target := filepath.Join(dest, filepath.FromSlash(rel))
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			data, err := io.ReadAll(tr)
			if err != nil {
				return err
			}
			if err := writeArchiveFile(target, data, os.FileMode(hdr.Mode).Perm()); err != nil {
				return err
			}
		case tar.TypeSymlink, tar.TypeLink:
			return fmt.Errorf("archive symlinks are not supported: %s", rel)
		default:
			return fmt.Errorf("unsupported archive entry type for %s", rel)
		}
	}
}

func extractArchive(archivePath, archiveName, dest string) error {
	name := strings.ToLower(strings.TrimSpace(archiveName))
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	switch {
	case strings.HasSuffix(name, ".zip"):
		return extractZipArchive(archivePath, dest)
	case strings.HasSuffix(name, ".tar.gz"), strings.HasSuffix(name, ".tgz"):
		gr, err := gzip.NewReader(file)
		if err != nil {
			return fmt.Errorf("invalid gzip archive: %w", err)
		}
		defer gr.Close()
		return extractTarStream(gr, dest)
	case strings.HasSuffix(name, ".tar"):
		return extractTarStream(file, dest)
	default:
		return fmt.Errorf("unsupported archive format: %s", archiveName)
	}
}

func hasOpenClawDir(root string) bool {
	info, err := os.Stat(filepath.Join(root, ".openclaw"))
	return err == nil && info.IsDir()
}

func dirDepth(rel string) int {
	if rel == "." || rel == "" {
		return 0
	}
	return len(strings.Split(filepath.ToSlash(rel), "/"))
}

func detectArchiveHomeRoot(extractDir string) (string, string, string, []string, error) {
	if hasOpenClawDir(extractDir) {
		return extractDir, "archive_root", "archive root", []string{"Archive root already contains .openclaw and will be copied as the instance home."}, nil
	}

	entries, err := os.ReadDir(extractDir)
	if err != nil {
		return "", "", "", nil, err
	}
	if len(entries) == 1 && entries[0].IsDir() {
		candidate := filepath.Join(extractDir, entries[0].Name())
		if hasOpenClawDir(candidate) {
			return candidate, "top_level_directory", entries[0].Name(), []string{fmt.Sprintf("Using top-level directory %q as the imported OpenClaw home.", entries[0].Name())}, nil
		}
	}

	var found []string
	err = filepath.WalkDir(extractDir, func(current string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(extractDir, current)
		if err != nil {
			return err
		}
		if dirDepth(rel) > 3 {
			return filepath.SkipDir
		}
		if rel != "." && hasOpenClawDir(current) {
			found = append(found, current)
			return filepath.SkipDir
		}
		return nil
	})
	if err != nil {
		return "", "", "", nil, err
	}
	if len(found) == 1 {
		rel, _ := filepath.Rel(extractDir, found[0])
		return found[0], "nested_directory", rel, []string{fmt.Sprintf("Detected nested OpenClaw home at %q inside the archive.", filepath.ToSlash(rel))}, nil
	}
	if len(found) > 1 {
		return "", "", "", nil, fmt.Errorf("archive contains multiple possible OpenClaw homes; keep only one .openclaw root")
	}
	return "", "", "", nil, fmt.Errorf("archive must contain a .openclaw directory at the root or inside a single top-level folder")
}

func copyDirContents(srcRoot, dstRoot string) error {
	return filepath.Walk(srcRoot, func(current string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(srcRoot, current)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dstRoot, rel)
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlinks are not supported in imported archives: %s", rel)
		}
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(current)
		if err != nil {
			return err
		}
		return writeArchiveFile(target, data, info.Mode().Perm())
	})
}

func buildContextTar(buildDir string) (*bytes.Buffer, error) {
	buf := &bytes.Buffer{}
	tw := tar.NewWriter(buf)
	err := filepath.Walk(buildDir, func(current string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(buildDir, current)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlinks are not supported in build context: %s", rel)
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = rel
		if err := tw.WriteHeader(header); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		f, err := os.Open(current)
		if err != nil {
			return err
		}
		defer f.Close()
		if _, err := io.Copy(tw, f); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		tw.Close()
		return nil, err
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	return buf, nil
}

func createZipArchive(srcRoot, archivePath string) error {
	file, err := os.Create(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	zw := zip.NewWriter(file)
	defer zw.Close()

	rootParent := filepath.Dir(srcRoot)
	return filepath.Walk(srcRoot, func(current string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlinks are not supported in exported archives: %s", current)
		}
		rel, err := filepath.Rel(rootParent, current)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = rel
		if info.IsDir() {
			header.Name += "/"
			header.Method = zip.Store
		} else {
			header.Method = zip.Deflate
		}
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		f, err := os.Open(current)
		if err != nil {
			return err
		}
		defer f.Close()
		if _, err := io.Copy(writer, f); err != nil {
			return err
		}
		return nil
	})
}

func createTarGzArchive(srcRoot, archivePath string) error {
	file, err := os.Create(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	gzw := gzip.NewWriter(file)
	defer gzw.Close()

	tw := tar.NewWriter(gzw)
	defer tw.Close()

	rootParent := filepath.Dir(srcRoot)
	return filepath.Walk(srcRoot, func(current string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlinks are not supported in exported archives: %s", current)
		}
		rel, err := filepath.Rel(rootParent, current)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = rel
		if err := tw.WriteHeader(header); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		f, err := os.Open(current)
		if err != nil {
			return err
		}
		defer f.Close()
		if _, err := io.Copy(tw, f); err != nil {
			return err
		}
		return nil
	})
}

func consumeDockerBuildOutput(r io.Reader) error {
	type buildMessage struct {
		Stream      string `json:"stream"`
		Error       string `json:"error"`
		ErrorDetail struct {
			Message string `json:"message"`
		} `json:"errorDetail"`
	}

	dec := json.NewDecoder(r)
	var streamTail strings.Builder
	for {
		var msg buildMessage
		if err := dec.Decode(&msg); err == io.EOF {
			break
		} else if err != nil {
			return fmt.Errorf("decode docker build output: %w", err)
		}
		if msg.Stream != "" {
			streamTail.WriteString(msg.Stream)
		}
		if msg.ErrorDetail.Message != "" {
			return fmt.Errorf("%s", strings.TrimSpace(msg.ErrorDetail.Message))
		}
		if msg.Error != "" {
			return fmt.Errorf("%s", strings.TrimSpace(msg.Error))
		}
	}
	return nil
}

func (d *DockerOrchestrator) BuildArchiveImage(ctx context.Context, params ArchiveImageBuildParams) (*ArchiveImageBuildResult, error) {
	if strings.TrimSpace(params.ArchivePath) == "" || strings.TrimSpace(params.ArchiveName) == "" {
		return nil, fmt.Errorf("archive path and name are required")
	}

	baseImage, baseContract, notes, err := d.resolveArchiveBaseImage(ctx, params.BaseImage)
	if err != nil {
		return nil, err
	}

	tempDir, err := os.MkdirTemp("", "claworc-archive-image-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tempDir)

	extractDir := filepath.Join(tempDir, "extract")
	buildDir := filepath.Join(tempDir, "build")
	preparedHomeDir := filepath.Join(buildDir, "prepared-home")
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(preparedHomeDir, 0o755); err != nil {
		return nil, err
	}

	if err := extractArchive(params.ArchivePath, params.ArchiveName, extractDir); err != nil {
		return nil, err
	}

	sourceRoot, detectedLayout, sourceLabel, detectedNotes, err := detectArchiveHomeRoot(extractDir)
	if err != nil {
		return nil, err
	}
	notes = append(notes, detectedNotes...)
	if err := copyDirContents(sourceRoot, preparedHomeDir); err != nil {
		return nil, err
	}

	dockerfile := fmt.Sprintf(`FROM %s
LABEL io.claworc.image-mode="prebuilt" \
      io.claworc.openclaw-user=%q \
      io.claworc.openclaw-home=%q

COPY prepared-home/ %s/
`, baseImage, baseContract.OpenClawUser, baseContract.OpenClawHome, baseContract.OpenClawHome)
	if err := os.WriteFile(filepath.Join(buildDir, "Dockerfile"), []byte(dockerfile), 0o644); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(buildDir, ".dockerignore"), []byte(""), 0o644); err != nil {
		return nil, err
	}

	imageRef := archiveImageRef(params.DisplayName, params.ArchiveName)
	contextTar, err := buildContextTar(buildDir)
	if err != nil {
		return nil, err
	}

	resp, err := d.client.ImageBuild(ctx, bytes.NewReader(contextTar.Bytes()), dockertypes.ImageBuildOptions{
		Tags:        []string{imageRef},
		Remove:      true,
		ForceRemove: true,
	})
	if err != nil {
		return nil, fmt.Errorf("build imported image: %w", err)
	}
	defer resp.Body.Close()
	if err := consumeDockerBuildOutput(resp.Body); err != nil {
		return nil, fmt.Errorf("build imported image: %w", err)
	}

	contract, err := d.ResolveImageContract(ctx, imageRef)
	if err != nil {
		return nil, err
	}
	notes = append(notes, fmt.Sprintf("Built local prebuilt image %q from archive %q.", imageRef, params.ArchiveName))

	return &ArchiveImageBuildResult{
		ImageRef:       imageRef,
		BaseImage:      baseImage,
		DetectedRoot:   sourceLabel,
		DetectedLayout: detectedLayout,
		Contract:       contract,
		Notes:          notes,
	}, nil
}

func (d *DockerOrchestrator) ExportInstanceBackup(ctx context.Context, params InstanceArchiveExportParams) (*InstanceArchiveExportResult, error) {
	format := normalizeArchiveExportFormat(params.Format)
	if format == "" {
		return nil, fmt.Errorf("unsupported archive format: %s", params.Format)
	}
	if strings.TrimSpace(params.Name) == "" {
		return nil, fmt.Errorf("instance name is required")
	}

	homeVolume := d.volumeName(params.Name, "home")
	if _, err := d.client.VolumeInspect(ctx, homeVolume); err != nil {
		if dockerclient.IsErrNotFound(err) {
			return nil, fmt.Errorf("instance home volume not found")
		}
		return nil, fmt.Errorf("inspect home volume: %w", err)
	}

	tempDir, err := os.MkdirTemp("", "claworc-export-*")
	if err != nil {
		return nil, err
	}

	rootDir := archiveExportRootName(params.DisplayName, params.Name)
	stagingParent := filepath.Join(tempDir, "staged")
	stagedRoot := filepath.Join(stagingParent, rootDir)
	if err := os.MkdirAll(stagingParent, 0o755); err != nil {
		os.RemoveAll(tempDir)
		return nil, err
	}

	if err := d.copyVolumeToDirectory(ctx, homeVolume, stagingParent, rootDir); err != nil {
		os.RemoveAll(tempDir)
		return nil, err
	}
	if !hasOpenClawDir(stagedRoot) {
		os.RemoveAll(tempDir)
		return nil, fmt.Errorf("instance home does not contain a .openclaw directory")
	}

	archiveName := archiveExportFilename(rootDir, format)
	archivePath := filepath.Join(tempDir, archiveName)

	switch format {
	case "zip":
		err = createZipArchive(stagedRoot, archivePath)
	case "tgz":
		err = createTarGzArchive(stagedRoot, archivePath)
	}
	if err != nil {
		os.RemoveAll(tempDir)
		return nil, err
	}

	return &InstanceArchiveExportResult{
		ArchivePath:   archivePath,
		ArchiveName:   archiveName,
		RootDirectory: rootDir,
		Format:        format,
		CleanupPath:   tempDir,
	}, nil
}

func (d *DockerOrchestrator) CreateInstance(ctx context.Context, params CreateParams) error {
	progress := params.OnProgress
	if progress == nil {
		progress = func(string) {}
	}

	progress("Pulling image...")
	if err := d.ensureImage(ctx, params.ContainerImage); err != nil {
		return err
	}

	progress("Inspecting image contract...")
	contract, err := d.ResolveImageContract(ctx, params.ContainerImage)
	if err != nil {
		return err
	}
	params.ImageMode = contract.Mode
	params.OpenClawUser = contract.OpenClawUser
	params.OpenClawHome = contract.OpenClawHome
	params.BrowserMetricsPath = contract.BrowserMetricsPath

	// Create volumes
	progress("Creating volumes...")
	for _, suffix := range volumeSuffixes {
		volName := d.volumeName(params.Name, suffix)
		_, err := d.client.VolumeCreate(ctx, volume.CreateOptions{
			Name:   volName,
			Labels: map[string]string{"managed-by": labelManagedBy, "instance": params.Name},
		})
		if err != nil {
			log.Printf("Volume %s may already exist: %v", utils.SanitizeForLog(volName), err)
		}
	}

	progress("Creating container...")
	return d.createContainer(ctx, params)
}

func (d *DockerOrchestrator) CloneVolumes(ctx context.Context, srcName, dstName string) error {
	// Stop destination container while we copy data into its volumes
	timeout := 30
	d.client.ContainerStop(ctx, dstName, container.StopOptions{Timeout: &timeout})

	for _, suffix := range volumeSuffixes {
		srcVol := d.volumeName(srcName, suffix)
		dstVol := d.volumeName(dstName, suffix)
		if err := d.copyVolume(ctx, srcVol, dstVol); err != nil {
			// Best-effort: restart destination even on error
			d.client.ContainerStart(ctx, dstName, container.StartOptions{})
			return fmt.Errorf("copy volume %s: %w", suffix, err)
		}
	}

	return d.client.ContainerStart(ctx, dstName, container.StartOptions{})
}

func (d *DockerOrchestrator) copyVolume(ctx context.Context, srcVol, dstVol string) error {
	_ = d.ensureImage(ctx, "alpine:latest")

	containerCfg := &container.Config{
		Image: "alpine:latest",
		Cmd:   []string{"sh", "-c", "cp -a /src/. /dst/"},
	}
	hostCfg := &container.HostConfig{
		Mounts: []mount.Mount{
			{Type: mount.TypeVolume, Source: srcVol, Target: "/src", ReadOnly: true},
			{Type: mount.TypeVolume, Source: dstVol, Target: "/dst"},
		},
	}

	resp, err := d.client.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, "")
	if err != nil {
		return fmt.Errorf("create copy container: %w", err)
	}
	defer d.client.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})

	if err := d.client.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return fmt.Errorf("start copy container: %w", err)
	}

	statusCh, errCh := d.client.ContainerWait(ctx, resp.ID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("wait for copy container: %w", err)
		}
	case status := <-statusCh:
		if status.StatusCode != 0 {
			return fmt.Errorf("copy failed with exit code %d", status.StatusCode)
		}
	}
	return nil
}

func (d *DockerOrchestrator) copyVolumeToDirectory(ctx context.Context, srcVol, dstDir, rootDir string) error {
	_ = d.ensureImage(ctx, "alpine:latest")

	containerCfg := &container.Config{
		Image: "alpine:latest",
		Cmd: []string{
			"sh",
			"-c",
			fmt.Sprintf("mkdir -p /out/%s && cp -aL /src/. /out/%s/ && test -d /out/%s/.openclaw", rootDir, rootDir, rootDir),
		},
	}
	hostCfg := &container.HostConfig{
		Mounts: []mount.Mount{
			{Type: mount.TypeVolume, Source: srcVol, Target: "/src", ReadOnly: true},
		},
	}

	resp, err := d.client.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, "")
	if err != nil {
		return fmt.Errorf("create export container: %w", err)
	}
	defer d.client.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})

	if err := d.client.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return fmt.Errorf("start export container: %w", err)
	}

	statusCh, errCh := d.client.ContainerWait(ctx, resp.ID, container.WaitConditionNotRunning)
	select {
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("wait for export container: %w", err)
		}
	case status := <-statusCh:
		if status.StatusCode != 0 {
			logs := d.readContainerLogs(ctx, resp.ID)
			if logs != "" {
				return fmt.Errorf("export staging failed: %s", logs)
			}
			return fmt.Errorf("export staging failed with exit code %d", status.StatusCode)
		}
	}

	reader, _, err := d.client.CopyFromContainer(ctx, resp.ID, "/out/"+rootDir)
	if err != nil {
		return fmt.Errorf("copy staged backup from container: %w", err)
	}
	defer reader.Close()

	if err := extractTarStream(reader, dstDir); err != nil {
		return fmt.Errorf("extract staged backup: %w", err)
	}
	return nil
}

func (d *DockerOrchestrator) readContainerLogs(ctx context.Context, containerID string) string {
	reader, err := d.client.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
	})
	if err != nil {
		return ""
	}
	defer reader.Close()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	if _, err := stdcopy.StdCopy(&stdout, &stderr, reader); err != nil {
		return strings.TrimSpace(stdout.String() + "\n" + stderr.String())
	}
	return strings.TrimSpace(stdout.String() + "\n" + stderr.String())
}

func (d *DockerOrchestrator) DeleteInstance(ctx context.Context, name string) error {
	// Remove container
	err := d.client.ContainerRemove(ctx, name, container.RemoveOptions{Force: true})
	if err != nil && !dockerclient.IsErrNotFound(err) {
		log.Printf("Remove container %s: %v", utils.SanitizeForLog(name), err)
	}

	// Remove volumes
	for _, suffix := range volumeSuffixes {
		volName := d.volumeName(name, suffix)
		if err := d.client.VolumeRemove(ctx, volName, true); err != nil && !dockerclient.IsErrNotFound(err) {
			log.Printf("Remove volume %s: %v", utils.SanitizeForLog(volName), err)
		}
	}
	return nil
}

func (d *DockerOrchestrator) StartInstance(ctx context.Context, name string) error {
	return d.client.ContainerStart(ctx, name, container.StartOptions{})
}

func (d *DockerOrchestrator) StopInstance(ctx context.Context, name string) error {
	timeout := 30
	return d.client.ContainerStop(ctx, name, container.StopOptions{Timeout: &timeout})
}

func (d *DockerOrchestrator) RestartInstance(ctx context.Context, name string) error {
	timeout := 30
	return d.client.ContainerRestart(ctx, name, container.StopOptions{Timeout: &timeout})
}

func (d *DockerOrchestrator) UpdateImage(ctx context.Context, name string, params CreateParams) error {
	// Force-pull the latest image (bypass local cache)
	log.Printf("Force-pulling image %s for instance %s", params.ContainerImage, utils.SanitizeForLog(name))
	reader, err := d.client.ImagePull(ctx, params.ContainerImage, image.PullOptions{})
	if err != nil {
		return fmt.Errorf("pull image %s: %w", params.ContainerImage, err)
	}
	defer reader.Close()
	io.Copy(io.Discard, reader)
	log.Printf("Image %s pulled successfully", params.ContainerImage)

	// Stop and remove the old container (volumes are preserved)
	timeout := 30
	d.client.ContainerStop(ctx, name, container.StopOptions{Timeout: &timeout})
	if err := d.client.ContainerRemove(ctx, name, container.RemoveOptions{Force: true}); err != nil && !dockerclient.IsErrNotFound(err) {
		return fmt.Errorf("remove container %s: %w", name, err)
	}

	contract, err := d.ResolveImageContract(ctx, params.ContainerImage)
	if err != nil {
		return err
	}
	params.ImageMode = contract.Mode
	params.OpenClawUser = contract.OpenClawUser
	params.OpenClawHome = contract.OpenClawHome
	params.BrowserMetricsPath = contract.BrowserMetricsPath
	// Recreate the container with the same config but fresh image
	return d.createContainer(ctx, params)
}

// createContainer builds and starts a container from CreateParams (without pulling or creating volumes).
func (d *DockerOrchestrator) createContainer(ctx context.Context, params CreateParams) error {
	contract := contractFromCreateParams(params)
	var env []string
	if parts := strings.SplitN(params.VNCResolution, "x", 2); len(parts) == 2 {
		env = append(env, "DISPLAY_WIDTH="+parts[0], "DISPLAY_HEIGHT="+parts[1])
	}
	bonjourDisabled := false
	for k, v := range params.EnvVars {
		if k == "OPENCLAW_DISABLE_BONJOUR" {
			bonjourDisabled = true
		}
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	if !bonjourDisabled {
		env = append(env, "OPENCLAW_DISABLE_BONJOUR=1")
	}
	if params.Timezone != "" {
		env = append(env, fmt.Sprintf("TZ=%s", params.Timezone))
	}
	if params.UserAgent != "" {
		env = append(env, fmt.Sprintf("CHROMIUM_USER_AGENT=%s", params.UserAgent))
	}
	env = append(env,
		fmt.Sprintf("CLAWORC_IMAGE_MODE=%s", contract.Mode),
		fmt.Sprintf("CLAWORC_OPENCLAW_USER=%s", contract.OpenClawUser),
		fmt.Sprintf("CLAWORC_OPENCLAW_HOME=%s", contract.OpenClawHome),
	)

	mounts := []mount.Mount{
		{Type: mount.TypeVolume, Source: d.volumeName(params.Name, "homebrew"), Target: "/home/linuxbrew/.linuxbrew"},
		{Type: mount.TypeVolume, Source: d.volumeName(params.Name, "home"), Target: contract.OpenClawHome},
		{
			Type:   mount.TypeTmpfs,
			Target: contract.BrowserMetricsPath,
			TmpfsOptions: &mount.TmpfsOptions{
				SizeBytes: browserMetricsTmpfsSize,
			},
		},
	}

	var nanoCPUs int64
	var memLimit int64
	if params.CPULimit != "" {
		nanoCPUs = parseCPUToNanoCPUs(params.CPULimit)
	}
	if params.MemoryLimit != "" {
		memLimit = parseMemoryToBytes(params.MemoryLimit)
	}

	shmSize, _ := units.RAMInBytes("2g")

	containerCfg := &container.Config{
		Image:    params.ContainerImage,
		Hostname: strings.TrimPrefix(params.Name, "bot-"),
		Env:      env,
		Labels:   map[string]string{"managed-by": labelManagedBy, "instance": params.Name},
		ExposedPorts: nat.PortSet{
			"22/tcp": struct{}{},
		},
		Healthcheck: &container.HealthConfig{
			Test:          []string{"CMD", "/usr/local/bin/claworc-healthcheck", "ready"},
			Interval:      30 * time.Second,
			Timeout:       10 * time.Second,
			Retries:       3,
			StartPeriod:   10 * time.Minute,
			StartInterval: 30 * time.Second,
		},
	}

	hostCfg := &container.HostConfig{
		Privileged: true,
		Mounts:     mounts,
		ShmSize:    shmSize,
		Resources: container.Resources{
			NanoCPUs: nanoCPUs,
			Memory:   memLimit,
		},
		PortBindings: nat.PortMap{
			"22/tcp": []nat.PortBinding{{HostIP: "127.0.0.1", HostPort: ""}},
		},
		RestartPolicy: container.RestartPolicy{Name: container.RestartPolicyUnlessStopped},
	}

	netCfg := &network.NetworkingConfig{
		EndpointsConfig: map[string]*network.EndpointSettings{
			networkName: {},
		},
	}

	resp, err := d.client.ContainerCreate(ctx, containerCfg, hostCfg, netCfg, nil, params.Name)
	if err != nil {
		return fmt.Errorf("create container: %w", err)
	}

	if err := d.client.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return err
	}

	return nil
}

func (d *DockerOrchestrator) GetInstanceStatus(ctx context.Context, name string) (string, error) {
	inspect, err := d.client.ContainerInspect(ctx, name)
	if err != nil {
		if dockerclient.IsErrNotFound(err) {
			return "stopped", nil
		}
		return "error", nil
	}

	status := inspect.State.Status
	health := ""
	if inspect.State.Health != nil {
		health = inspect.State.Health.Status
	}

	switch status {
	case "running":
		if inspect.State.Health == nil {
			return "running", nil
		}
		switch health {
		case "healthy":
			return "running", nil
		case "unhealthy":
			return "error", nil
		default:
			return "creating", nil
		}
	case "created", "restarting":
		return "creating", nil
	case "exited", "dead", "paused", "removing":
		return "stopped", nil
	default:
		return "stopped", nil
	}
}

func (d *DockerOrchestrator) GetInstanceImageInfo(ctx context.Context, name string) (string, error) {
	inspect, err := d.client.ContainerInspect(ctx, name)
	if err != nil {
		if dockerclient.IsErrNotFound(err) {
			return "", nil
		}
		return "", fmt.Errorf("inspect container: %w", err)
	}
	tag := inspect.Config.Image
	sha := inspect.Image
	if len(sha) > 19 { // "sha256:" (7) + 12 chars
		sha = sha[:19]
	}
	return fmt.Sprintf("%s (%s)", tag, sha), nil
}

func (d *DockerOrchestrator) ConfigureSSHAccess(ctx context.Context, instanceID uint, publicKey string) error {
	var inst database.Instance
	if err := database.DB.First(&inst, instanceID).Error; err != nil {
		return fmt.Errorf("instance %d not found: %w", instanceID, err)
	}
	return configureSSHAccess(ctx, d.ExecInInstance, inst.Name, publicKey)
}

func (d *DockerOrchestrator) GetSSHAddress(ctx context.Context, instanceID uint) (string, int, error) {
	var inst database.Instance
	if err := database.DB.First(&inst, instanceID).Error; err != nil {
		return "", 0, fmt.Errorf("instance %d not found: %w", instanceID, err)
	}
	inspect, err := d.client.ContainerInspect(ctx, inst.Name)
	if err != nil {
		return "", 0, fmt.Errorf("inspect container for instance %d: %w", instanceID, err)
	}

	// Detect whether the control-plane itself is running inside a Docker container.
	// /.dockerenv is created by the Docker runtime in every container.
	runningInDocker := false
	if _, err := os.Stat("/.dockerenv"); err == nil {
		runningInDocker = true
	}

	// Inside Docker: use the container IP on the claworc bridge network for
	// direct container-to-container communication (no port mapping needed).
	if runningInDocker {
		if ep, ok := inspect.NetworkSettings.Networks[networkName]; ok && ep.IPAddress != "" {
			return ep.IPAddress, 22, nil
		}
	}

	// On the host (e.g. macOS / Windows): Docker bridge IPs are not routable
	// from the host OS, so use the published host port on the loopback instead.
	if bindings, ok := inspect.NetworkSettings.Ports["22/tcp"]; ok && len(bindings) > 0 {
		port := 0
		fmt.Sscanf(bindings[0].HostPort, "%d", &port)
		if port > 0 {
			return "127.0.0.1", port, nil
		}
	}

	// Fallback: on Linux hosts bridge IPs are routable from the host, so the
	// container IP still works even when we're not inside Docker ourselves.
	if ep, ok := inspect.NetworkSettings.Networks[networkName]; ok && ep.IPAddress != "" {
		return ep.IPAddress, 22, nil
	}

	return "", 0, fmt.Errorf("cannot determine SSH address for instance %d", instanceID)
}

func (d *DockerOrchestrator) UpdateResources(ctx context.Context, name string, params UpdateResourcesParams) error {
	updateCfg := container.UpdateConfig{
		Resources: container.Resources{
			NanoCPUs: parseCPUToNanoCPUs(params.CPULimit),
			Memory:   parseMemoryToBytes(params.MemoryLimit),
		},
	}
	_, err := d.client.ContainerUpdate(ctx, name, updateCfg)
	return err
}

func (d *DockerOrchestrator) GetContainerStats(ctx context.Context, name string) (*ContainerStats, error) {
	resp, err := d.client.ContainerStatsOneShot(ctx, name)
	if err != nil {
		return nil, fmt.Errorf("container stats: %w", err)
	}
	defer resp.Body.Close()

	var statsJSON dockerStatsJSON
	if err := json.NewDecoder(resp.Body).Decode(&statsJSON); err != nil {
		return nil, fmt.Errorf("decode stats: %w", err)
	}

	// CPU usage calculation (same formula as docker stats CLI)
	cpuDelta := float64(statsJSON.CPUStats.CPUUsage.TotalUsage - statsJSON.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(statsJSON.CPUStats.SystemCPUUsage - statsJSON.PreCPUStats.SystemCPUUsage)
	numCPUs := float64(statsJSON.CPUStats.OnlineCPUs)
	if numCPUs == 0 {
		numCPUs = float64(len(statsJSON.CPUStats.CPUUsage.PercpuUsage))
	}

	var cpuCores float64
	if systemDelta > 0 && numCPUs > 0 {
		cpuCores = (cpuDelta / systemDelta) * numCPUs
	}
	cpuMillicores := int64(cpuCores * 1000)

	memUsage := statsJSON.MemoryStats.Usage
	memLimit := statsJSON.MemoryStats.Limit

	var cpuPercent float64
	if memLimit > 0 && statsJSON.CPUStats.CPUUsage.TotalUsage > 0 {
		// Calculate CPU % of limit using NanoCPUs from container config
		inspect, err := d.client.ContainerInspect(ctx, name)
		if err == nil && inspect.HostConfig.NanoCPUs > 0 {
			limitCores := float64(inspect.HostConfig.NanoCPUs) / 1e9
			cpuPercent = (cpuCores / limitCores) * 100
		}
	}

	return &ContainerStats{
		CPUUsageMillicores: cpuMillicores,
		CPUUsagePercent:    cpuPercent,
		MemoryUsageBytes:   int64(memUsage),
		MemoryLimitBytes:   int64(memLimit),
	}, nil
}

type dockerStatsJSON struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage  uint64   `json:"total_usage"`
			PercpuUsage []uint64 `json:"percpu_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     uint32 `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64 `json:"usage"`
		Limit uint64 `json:"limit"`
	} `json:"memory_stats"`
}

func (d *DockerOrchestrator) UpdateInstanceConfig(ctx context.Context, name string, configJSON string) error {
	return updateInstanceConfig(ctx, d.ExecInInstance, d.InstanceFactory, name, configJSON)
}

func stripDockerLogHeaders(data []byte) string {
	// Docker multiplexed log format: [stream_type(1)][0(3)][size(4)][payload]
	// If the data starts with a valid header byte (0, 1, or 2), try to strip
	var result strings.Builder
	for len(data) > 0 {
		if len(data) >= 8 && (data[0] == 0 || data[0] == 1 || data[0] == 2) {
			size := int(data[4])<<24 | int(data[5])<<16 | int(data[6])<<8 | int(data[7])
			data = data[8:]
			if size > 0 && size <= len(data) {
				result.Write(data[:size])
				data = data[size:]
			} else {
				result.Write(data)
				break
			}
		} else {
			result.Write(data)
			break
		}
	}
	return result.String()
}

func (d *DockerOrchestrator) ExecInInstance(ctx context.Context, name string, cmd []string) (string, string, int, error) {
	execCfg := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}

	execID, err := d.client.ContainerExecCreate(ctx, name, execCfg)
	if err != nil {
		return "", "", -1, fmt.Errorf("exec create: %w", err)
	}

	resp, err := d.client.ContainerExecAttach(ctx, execID.ID, container.ExecAttachOptions{})
	if err != nil {
		return "", "", -1, fmt.Errorf("exec attach: %w", err)
	}
	defer resp.Close()

	output, err := io.ReadAll(resp.Reader)
	if err != nil {
		return "", "", -1, fmt.Errorf("read exec output: %w", err)
	}

	// Get exit code
	inspectResp, err := d.client.ContainerExecInspect(ctx, execID.ID)
	if err != nil {
		return string(output), "", -1, fmt.Errorf("exec inspect: %w", err)
	}

	// Docker exec with demux=false returns multiplexed output
	// For simplicity, treat all output as stdout
	cleaned := stripDockerLogHeaders(output)
	return cleaned, "", inspectResp.ExitCode, nil
}

// Ensure DockerOrchestrator implements ContainerOrchestrator
var _ ContainerOrchestrator = (*DockerOrchestrator)(nil)
