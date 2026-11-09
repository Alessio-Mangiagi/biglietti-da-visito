import { execSync } from 'node:child_process';

/**
 * Windows does not forward termination signals to the e2e stack, so its embedded
 * PostgreSQL (data dir "cardvault-e2e-*") would outlive the run. Workers exit on their
 * own once the postmaster is gone.
 */
export default function teardown() {
  try {
    if (process.platform === 'win32') {
      execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'cardvault-e2e-\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
        { stdio: 'ignore' },
      );
    } else {
      execSync('pkill -f cardvault-e2e- || true', { stdio: 'ignore' });
    }
  } catch {
    /* nothing left to stop */
  }
}
