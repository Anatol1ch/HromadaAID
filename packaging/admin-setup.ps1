param(
  [Parameter(Mandatory = $true)][string]$NodeExecutable,
  [Parameter(Mandatory = $true)][string]$CreateAdminScript,
  [Parameter(Mandatory = $true)][string]$DatabasePath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Invoke-FirstAdministratorForm {
  $form = New-Object Windows.Forms.Form
  $form.Text = 'Створення адміністратора HromadaAID'
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ClientSize = [Drawing.Size]::new(470, 300)
  $form.Font = [Drawing.Font]::new('Segoe UI', 9)

  $title = New-Object Windows.Forms.Label
  $title.Text = 'Створення адміністратора'
  $title.Font = [Drawing.Font]::new('Segoe UI', 14, [Drawing.FontStyle]::Bold)
  $title.Location = [Drawing.Point]::new(18, 14); $title.Size = [Drawing.Size]::new(430, 28)
  $note = New-Object Windows.Forms.Label
  $note.Text = 'Ці дані потрібні для першого входу. Пароль не зберігатиметься в інсталяторі.'
  $note.Location = [Drawing.Point]::new(20, 48); $note.Size = [Drawing.Size]::new(430, 34)
  $controls = @{}
  $rows = @(@('Логін адміністратора', 88, $false), @('Пароль (8–256 символів)', 133, $true), @('Підтвердження пароля', 178, $true))
  foreach ($row in $rows) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $row[0]; $label.Location = [Drawing.Point]::new(20, [int]$row[1]); $label.Size = [Drawing.Size]::new(190, 24)
    $box = New-Object Windows.Forms.TextBox
    $box.Location = [Drawing.Point]::new(210, ([int]$row[1] - 3)); $box.Size = [Drawing.Size]::new(238, 24)
    if ($row[2]) { $box.UseSystemPasswordChar = $true }
    $form.Controls.Add($label); $form.Controls.Add($box); $controls[$row[0]] = $box
  }
  $errorLabel = New-Object Windows.Forms.Label
  $errorLabel.ForeColor = [Drawing.Color]::Firebrick; $errorLabel.Location = [Drawing.Point]::new(20, 212); $errorLabel.Size = [Drawing.Size]::new(430, 28)
  $submit = New-Object Windows.Forms.Button
  $submit.Text = 'Створити адміністратора'; $submit.Location = [Drawing.Point]::new(255, 253); $submit.Size = [Drawing.Size]::new(193, 30); $submit.DialogResult = [Windows.Forms.DialogResult]::None
  $cancel = New-Object Windows.Forms.Button
  $cancel.Text = 'Скасувати'; $cancel.Location = [Drawing.Point]::new(150, 253); $cancel.Size = [Drawing.Size]::new(95, 30); $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
  $form.Controls.AddRange(@($title, $note, $errorLabel, $submit, $cancel))
  $form.AcceptButton = $submit; $form.CancelButton = $cancel
  $result = @{ Success = $false }
  $submit.Add_Click({
    $username = [string]$controls['Логін адміністратора'].Text
    $password = [string]$controls['Пароль (8–256 символів)'].Text
    $confirmation = [string]$controls['Підтвердження пароля'].Text
    if ($password -cne $confirmation) { $errorLabel.Text = 'Паролі не збігаються.'; return }
    if ([string]::IsNullOrWhiteSpace($username) -or $password.Length -lt 8 -or $password.Length -gt 256) { $errorLabel.Text = 'Перевірте логін і довжину пароля (8–256 символів).'; return }
    $submit.Enabled = $false
    $process = $null
    try {
      $info = New-Object Diagnostics.ProcessStartInfo
      $info.FileName = $NodeExecutable
      $info.Arguments = '"' + $CreateAdminScript + '" --database "' + $DatabasePath + '" --installer-stdin'
      $info.WorkingDirectory = Split-Path -Parent (Split-Path -Parent $CreateAdminScript)
      $info.UseShellExecute = $false; $info.CreateNoWindow = $true
      $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
      $process = New-Object Diagnostics.Process
      $process.StartInfo = $info
      if (-not $process.Start()) { throw 'Не вдалося запустити перевірку адміністратора.' }
      $stdoutTask = $process.StandardOutput.ReadToEndAsync()
      $stderrTask = $process.StandardError.ReadToEndAsync()
      $payload = ConvertTo-Json -InputObject @{ username = $username; password = $password; confirmation = $confirmation } -Compress
      $process.StandardInput.WriteLine($payload)
      $process.StandardInput.Close()
      $payload = $null; $password = ''; $confirmation = ''; $username = ''
      $controls['Пароль (8–256 символів)'].Clear(); $controls['Підтвердження пароля'].Clear()
      $process.WaitForExit()
      $outText = $stdoutTask.Result.Trim()
      $null = $stderrTask.Result.Trim()
      if ($process.ExitCode -ne 0 -or $outText -ne 'admin-created') {
        $errorLabel.Text = 'Не вдалося створити адміністратора. Перевірте логін, пароль і стан бази даних.'
        $submit.Enabled = $true
        return
      }
      $result.Success = $true
      $form.DialogResult = [Windows.Forms.DialogResult]::OK
      $form.Close()
    } catch {
      $errorLabel.Text = 'Не вдалося створити адміністратора. Дані та пароль не видалено; повторіть спробу після перевірки сервера.'
      $submit.Enabled = $true
    } finally {
      if ($process) { $process.Dispose() }
      $password = ''; $confirmation = ''; $payload = $null
    }
  })
  $dialogResult = $form.ShowDialog()
  foreach ($box in $controls.Values) { $box.Clear() }
  $form.Dispose()
  if ($dialogResult -ne [Windows.Forms.DialogResult]::OK -or -not $result.Success) { return $false }
  return $true
}

try {
  if (Invoke-FirstAdministratorForm) { exit 0 }
  [Console]::Error.WriteLine('Створення першого адміністратора скасовано. Дані сервера залишено для контрольованого повторного запуску.')
  exit 2
} catch {
  [Console]::Error.WriteLine('Не вдалося відкрити форму створення адміністратора.')
  exit 1
}
