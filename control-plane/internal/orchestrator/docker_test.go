package orchestrator

import "testing"

func TestBackupExportHasOnlyIgnoredStagingErrors(t *testing.T) {
	logs := `
cp: can't stat '/src/./chrome-data/SingletonLock': No such file or directory
cp: can't stat '/src/./chrome-data/SingletonCookie': No such file or directory
cp: can't stat '/src/./chrome-data/SingletonSocket': No such file or directory
`

	if !backupExportHasOnlyIgnoredStagingErrors(logs) {
		t.Fatal("expected Chromium singleton copy errors to be ignored")
	}
}

func TestBackupExportHasOnlyIgnoredStagingErrorsRejectsUnexpectedLines(t *testing.T) {
	logs := `
cp: can't stat '/src/./chrome-data/SingletonLock': No such file or directory
cp: can't stat '/src/./important-file': Permission denied
`

	if backupExportHasOnlyIgnoredStagingErrors(logs) {
		t.Fatal("expected unexpected staging errors to remain fatal")
	}
}

func TestBackupExportHasOnlyIgnoredStagingErrorsRejectsEmptyLogs(t *testing.T) {
	if backupExportHasOnlyIgnoredStagingErrors("") {
		t.Fatal("expected empty logs to stay non-ignorable")
	}
}
