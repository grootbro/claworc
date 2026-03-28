# Prebuilt OpenClaw Images in Claworc

Claworc can now treat custom **prebuilt OpenClaw images** as first-class agent images on the Docker backend.

## UI workflow

In the dashboard:

1. Keep **Settings → Agent Image → Default Managed Agent Image** for your normal base image.
2. On an existing bot, use **Download Backup (.zip)** in the instance detail page when you want a restore-ready archive of its current OpenClaw home.
3. In **Create Instance**, choose **Prebuilt Image** when you want to start from a baked OpenClaw home.
4. Paste the custom image reference and click **Inspect image** to preview the resolved runtime contract.
5. Create the instance as usual.

Managed and prebuilt images now have distinct roles in the UI:

- **Managed Image**: admin-approved default for ordinary fresh instances.
- **Prebuilt Image**: custom image with baked `~/.openclaw`, skills, tools, workspace files, or migrations.
- **Archive Import**: upload a `.zip`, `.tar`, `.tar.gz`, or `.tgz`; Claworc builds a local prebuilt image from it, then you create the instance from that generated image.

For native round-tripping:

- **Backup Export (.zip)**: downloads a restore-ready archive from an existing bot's current home volume.
- **Advanced Backup (.tgz)**: same content, but in `tar.gz` format for Linux-oriented workflows.

The inspection step pulls the image if needed and shows the resolved:

- `mode`
- `openclaw user`
- `openclaw home`
- browser metrics path

The archive import step:

- extracts the uploaded archive safely
- detects the OpenClaw home root
- builds a local immutable prebuilt image on top of your managed base image
- returns the generated image reference before instance creation

## Why this exists

Official OpenClaw docs keep config in `~/.openclaw/openclaw.json` and the Docker install guide shows that the runtime home can vary by image, for example `/home/node`. Claworc used to assume `/home/claworc` everywhere, which made custom prebuilt images fragile.

## Supported image labels

Add these OCI labels to your image:

```dockerfile
LABEL io.claworc.image-mode="prebuilt" \
      io.claworc.openclaw-user="claworc" \
      io.claworc.openclaw-home="/home/claworc"
```

Recognized labels:

- `io.claworc.image-mode`: informational mode flag. Use `prebuilt` for your own prepared image.
- `io.claworc.openclaw-user`: runtime user for `openclaw config ...` and `openclaw gateway ...`.
- `io.claworc.openclaw-home`: home directory that contains `.openclaw/`.

## Recommended build pattern

Use a Claworc-compatible base image so SSH, desktop, and the browser stack stay intact:

```dockerfile
FROM grootbro/openclaw-vnc-chromium:ravefox-20260329-imagecontract

LABEL io.claworc.image-mode="prebuilt" \
      io.claworc.openclaw-user="claworc" \
      io.claworc.openclaw-home="/home/claworc"

COPY prepared-openclaw-home/ /home/claworc/
```

Your baked image can include:

- `~/.openclaw/openclaw.json`
- skills
- workspace files
- browser defaults
- additional tool and runtime dependencies

Archive imports follow the same contract. The uploaded archive can be:

- the home root itself containing `.openclaw/`
- a single top-level folder containing `.openclaw/`

Examples:

```text
.openclaw/openclaw.json
.openclaw/workspace/
skills/
```

```text
my-export/.openclaw/openclaw.json
my-export/.openclaw/workspace/
my-export/skills/
```

Validation rules:

- keep exactly one `.openclaw` root in the archive
- use regular files and directories only; symlinks are rejected
- use `.zip`, `.tar`, `.tar.gz`, or `.tgz`
- if Claworc detects a nested root, the UI shows which folder it selected before you create the instance

Backup exports are generated with a single top-level folder that already contains the bot home. That means the default `.zip` backup can be uploaded back into **Archive Import** without repacking it first.

Claworc still mounts a persistent home volume for the instance. On first create, Docker initializes that empty volume from the image path, so the baked OpenClaw home becomes the starting state.

## Current scope

This is designed for **Claworc-compatible** agent images.

If you use the plain upstream OpenClaw gateway-only image from the official Docker guide, you still need the Claworc agent contract around it, including SSH, browser/VNC stack, and the expected sibling-container runtime, before it can work as a managed Claworc instance.
