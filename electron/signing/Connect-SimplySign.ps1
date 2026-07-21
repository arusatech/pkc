<#
  Connect-SimplySign.ps1
  ----------------------
  Unlocks Certum SimplySign Desktop so the code-signing cert is in the Windows store.
  Adapted for PKC release builds (see env.signing.example).

  Required env:
    CERTUM_OTP_URI   otpauth://totp/... (from SimplySign enrollment QR / password manager)
    CERTUM_EXE_PATH  path to SimplySignDesktop.exe

  Optional:
    CERTUM_USERID    if your SimplySign login prompts for a user id first

  Usage (PowerShell):
    .\.env.signing loading is up to you; then:
    pwsh -ExecutionPolicy Bypass -File .\electron\signing\Connect-SimplySign.ps1
#>

$ErrorActionPreference = 'Stop'

$OtpUri  = $env:CERTUM_OTP_URI
$UserId  = $env:CERTUM_USERID
$ExePath = $env:CERTUM_EXE_PATH

if (-not $OtpUri)  { throw 'Set CERTUM_OTP_URI (otpauth://totp/...)' }
if (-not $ExePath) { throw 'Set CERTUM_EXE_PATH to SimplySignDesktop.exe' }
if (-not (Test-Path $ExePath)) { throw "SimplySign not found: $ExePath" }

$uri = [Uri]$OtpUri
try {
  $q = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
} catch {
  $q = @{}
  foreach ($part in $uri.Query.TrimStart('?') -split '&') {
    $kv = $part -split '=', 2
    if ($kv.Count -eq 2) { $q[$kv[0]] = [Uri]::UnescapeDataString($kv[1]) }
  }
}

$Base32 = $q['secret']
$Digits = if ($q['digits']) { [int]$q['digits'] } else { 6 }
$Period = if ($q['period']) { [int]$q['period'] } else { 30 }
if (-not $Base32) { throw 'CERTUM_OTP_URI missing secret=' }

Add-Type -Language CSharp @"
using System;
using System.Security.Cryptography;
public static class Totp {
  private const string B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  private static byte[] Base32Decode(string s) {
    s = s.TrimEnd('=').ToUpperInvariant();
    int byteCount = s.Length * 5 / 8;
    byte[] bytes = new byte[byteCount];
    int bitBuffer = 0, bitsLeft = 0, idx = 0;
    foreach (char c in s) {
      int val = B32.IndexOf(c);
      if (val < 0) throw new ArgumentException("Invalid Base32");
      bitBuffer = (bitBuffer << 5) | val;
      bitsLeft += 5;
      if (bitsLeft >= 8) {
        bytes[idx++] = (byte)(bitBuffer >> (bitsLeft - 8));
        bitsLeft -= 8;
      }
    }
    return bytes;
  }
  public static string Now(string secret, int digits, int period) {
    byte[] key = Base32Decode(secret);
    long counter = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / period;
    byte[] cnt = BitConverter.GetBytes(counter);
    if (BitConverter.IsLittleEndian) Array.Reverse(cnt);
    byte[] hash = new HMACSHA1(key).ComputeHash(cnt);
    int offset = hash[hash.Length - 1] & 0x0F;
    int binary =
      ((hash[offset] & 0x7F) << 24) |
      ((hash[offset + 1] & 0xFF) << 16) |
      ((hash[offset + 2] & 0xFF) << 8) |
      (hash[offset + 3] & 0xFF);
    int otp = binary % (int)Math.Pow(10, digits);
    return otp.ToString(new string('0', digits));
  }
}
"@

$otp = [Totp]::Now($Base32, $Digits, $Period)
Write-Host "Current TOTP: $otp"

$proc = Start-Process -FilePath $ExePath -PassThru
Start-Sleep -Seconds 4
$wshell = New-Object -ComObject WScript.Shell
$focused = $wshell.AppActivate($proc.Id)
if (-not $focused) { $focused = $wshell.AppActivate('SimplySign Desktop') }
for ($i = 0; -not $focused -and $i -lt 12; $i++) {
  Start-Sleep -Milliseconds 500
  $focused = $wshell.AppActivate($proc.Id) -or $wshell.AppActivate('SimplySign Desktop')
}
if (-not $focused) { throw 'Could not focus SimplySign Desktop window' }

Start-Sleep -Milliseconds 400
if ($UserId) {
  $wshell.SendKeys("$UserId{TAB}")
  Start-Sleep -Milliseconds 200
}
$wshell.SendKeys("$otp{ENTER}")
Write-Host 'Credentials sent — wait a few seconds for the virtual smart card to mount, then npm run release:win'
