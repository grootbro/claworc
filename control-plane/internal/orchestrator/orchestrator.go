package orchestrator

import (
	"context"

	"github.com/gluk-w/claworc/control-plane/internal/sshproxy"
)

// ContainerOrchestrator thin abstraction providing generic primitives (exec, read/write files)
type ContainerOrchestrator interface {
	Initialize(ctx context.Context) error
	IsAvailable(ctx context.Context) bool
	BackendName() string

	// Lifecycle
	CreateInstance(ctx context.Context, params CreateParams) error
	DeleteInstance(ctx context.Context, name string) error
	StartInstance(ctx context.Context, name string) error
	StopInstance(ctx context.Context, name string) error
	RestartInstance(ctx context.Context, name string) error
	GetInstanceStatus(ctx context.Context, name string) (string, error)
	GetInstanceImageInfo(ctx context.Context, name string) (string, error)
	ResolveImageContract(ctx context.Context, imageRef string) (ImageContract, error)
	BuildArchiveImage(ctx context.Context, params ArchiveImageBuildParams) (*ArchiveImageBuildResult, error)
	ExportInstanceBackup(ctx context.Context, params InstanceArchiveExportParams) (*InstanceArchiveExportResult, error)
	RestoreInstanceBackup(ctx context.Context, params InstanceArchiveRestoreParams) (*InstanceArchiveRestoreResult, error)

	// Config
	UpdateInstanceConfig(ctx context.Context, name string, configJSON string) error

	// Resources
	UpdateResources(ctx context.Context, name string, params UpdateResourcesParams) error
	GetContainerStats(ctx context.Context, name string) (*ContainerStats, error)

	// Image
	UpdateImage(ctx context.Context, name string, params CreateParams) error

	// Clone
	CloneVolumes(ctx context.Context, srcName, dstName string) error

	// SSH
	ConfigureSSHAccess(ctx context.Context, instanceID uint, publicKey string) error
	GetSSHAddress(ctx context.Context, instanceID uint) (host string, port int, err error)

	// Exec
	ExecInInstance(ctx context.Context, name string, cmd []string) (stdout string, stderr string, exitCode int, err error)
}

type ImageContract struct {
	Mode               string
	OpenClawUser       string
	OpenClawHome       string
	BrowserMetricsPath string
}

type ArchiveImageBuildParams struct {
	DisplayName string
	BaseImage   string
	ArchiveName string
	ArchivePath string
}

type ArchiveImageBuildResult struct {
	ImageRef       string
	BaseImage      string
	DetectedRoot   string
	DetectedLayout string
	Contract       ImageContract
	Notes          []string
}

type InstanceArchiveExportParams struct {
	Name        string
	DisplayName string
	Format      string
}

type InstanceArchiveExportResult struct {
	ArchivePath   string
	ArchiveName   string
	RootDirectory string
	Format        string
	CleanupPath   string
}

type InstanceArchiveRestoreParams struct {
	Name        string
	ArchiveName string
	ArchivePath string
}

type InstanceArchiveRestoreResult struct {
	DetectedRoot   string
	DetectedLayout string
	Notes          []string
}

type CreateParams struct {
	Name               string
	CPURequest         string
	CPULimit           string
	MemoryRequest      string
	MemoryLimit        string
	StorageHomebrew    string
	StorageHome        string
	ContainerImage     string
	VNCResolution      string
	Timezone           string
	UserAgent          string
	ImageMode          string
	OpenClawUser       string
	OpenClawHome       string
	BrowserMetricsPath string
	EnvVars            map[string]string
	OnProgress         func(string)
}

type UpdateResourcesParams struct {
	CPURequest    string
	CPULimit      string
	MemoryRequest string
	MemoryLimit   string
}

type ContainerStats struct {
	CPUUsageMillicores int64   `json:"cpu_usage_millicores"`
	CPUUsagePercent    float64 `json:"cpu_usage_percent"` // percentage of CPU limit
	MemoryUsageBytes   int64   `json:"memory_usage_bytes"`
	MemoryLimitBytes   int64   `json:"memory_limit_bytes"` // from container runtime
}

// FileEntry is a type alias for sshproxy.FileEntry, kept for backward compatibility.
type FileEntry = sshproxy.FileEntry
