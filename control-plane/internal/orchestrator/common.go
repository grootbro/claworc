package orchestrator

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/gluk-w/claworc/control-plane/internal/sshproxy"
)

const (
	DefaultImageMode    = "managed"
	DefaultOpenClawUser = "claworc"
	DefaultOpenClawHome = "/home/claworc"
	PathOpenClawConfig  = DefaultOpenClawHome + "/.openclaw/openclaw.json"
)

func EffectiveOpenClawUser(user string) string {
	user = strings.TrimSpace(user)
	if user == "" {
		return DefaultOpenClawUser
	}
	return user
}

func EffectiveOpenClawHome(home string) string {
	home = strings.TrimSpace(home)
	if home == "" {
		return DefaultOpenClawHome
	}
	return strings.TrimRight(home, "/")
}

func OpenClawConfigPath(home string) string {
	return EffectiveOpenClawHome(home) + "/.openclaw/openclaw.json"
}

func DefaultBrowserMetricsPath(home string) string {
	return EffectiveOpenClawHome(home) + "/chrome-data/DeferredBrowserMetrics"
}

func NormalizeImageContract(contract ImageContract) ImageContract {
	contract.Mode = strings.TrimSpace(contract.Mode)
	if contract.Mode == "" {
		contract.Mode = DefaultImageMode
	}

	contract.OpenClawHome = EffectiveOpenClawHome(contract.OpenClawHome)

	if strings.TrimSpace(contract.OpenClawUser) == "" && strings.HasPrefix(contract.OpenClawHome, "/home/") {
		if user := strings.TrimPrefix(contract.OpenClawHome, "/home/"); user != "" && !strings.Contains(user, "/") {
			contract.OpenClawUser = user
		}
	}
	contract.OpenClawUser = EffectiveOpenClawUser(contract.OpenClawUser)

	contract.BrowserMetricsPath = strings.TrimSpace(contract.BrowserMetricsPath)
	if contract.BrowserMetricsPath == "" {
		contract.BrowserMetricsPath = DefaultBrowserMetricsPath(contract.OpenClawHome)
	}

	return contract
}

// ExecFunc matches the ExecInInstance method signature.
type ExecFunc func(ctx context.Context, name string, cmd []string) (string, string, int, error)

func configureSSHAccess(ctx context.Context, execFn ExecFunc, name string, publicKey string) error {
	_, stderr, code, err := execFn(ctx, name, []string{"sh", "-c", "mkdir -p /root/.ssh && chmod 700 /root/.ssh"})
	if err != nil {
		return fmt.Errorf("create .ssh directory: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("create .ssh directory: %s", stderr)
	}

	b64 := base64.StdEncoding.EncodeToString([]byte(publicKey))
	cmd := []string{"sh", "-c", fmt.Sprintf("echo '%s' | base64 -d > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys", b64)}
	_, stderr, code, err = execFn(ctx, name, cmd)
	if err != nil {
		return fmt.Errorf("write authorized_keys: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("write authorized_keys: %s", stderr)
	}

	return nil
}

func updateInstanceConfig(ctx context.Context, execFn ExecFunc, factory sshproxy.InstanceFactory, name string, configJSON string) error {
	b64 := base64.StdEncoding.EncodeToString([]byte(configJSON))
	cmd := []string{"sh", "-c", fmt.Sprintf("echo '%s' | base64 -d > %s", b64, PathOpenClawConfig)}
	_, stderr, code, err := execFn(ctx, name, cmd)
	if err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	if code != 0 {
		return fmt.Errorf("write config: %s", stderr)
	}

	inst, err := factory(ctx, name)
	if err != nil {
		return fmt.Errorf("get instance connection: %w", err)
	}
	if _, stderr, code, err := inst.ExecOpenclaw(ctx, "gateway", "stop"); err != nil || code != 0 {
		return fmt.Errorf("restart gateway: %v %s", err, stderr)
	}
	return nil
}
