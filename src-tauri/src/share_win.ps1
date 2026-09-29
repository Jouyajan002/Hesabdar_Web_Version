$FilePath = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__FILE_B64__'))
$script:shareTitle = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__TITLE_B64__'))
$LogPath = '__LOG_PATH__'
$WinX = 120
$WinY = 80
$WinW = 1100
$WinH = 740
function Emit($m){ try { [Console]::Out.WriteLine([string]$m) } catch {} ; try { [System.IO.File]::AppendAllText($LogPath, ([string]$m) + [Environment]::NewLine, [System.Text.Encoding]::UTF8) } catch {} }
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    Add-Type -AssemblyName System.Drawing | Out-Null
    Emit 'STEP1_OK winforms'
    $iface = @'
using System;
using System.Text;
using System.Diagnostics;
using System.Security.Principal;
using System.Runtime.InteropServices;
[ComImport, Guid("3A3DCD6C-3EAB-43DC-BCDE-45671CE800C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDTMInterop {
    [return: MarshalAs(UnmanagedType.IInspectable)] object GetForWindow(IntPtr hwnd, [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid);
    void ShowShareUIForWindow(IntPtr hwnd);
}
public static class JouyaDtm {
    [return: MarshalAs(UnmanagedType.IInspectable)]
    public static object GetForWindow(object factory, IntPtr hwnd, Guid iid) {
        return ((IDTMInterop)factory).GetForWindow(hwnd, iid);
    }
    public static void ShowUI(object factory, IntPtr hwnd) {
        ((IDTMInterop)factory).ShowShareUIForWindow(hwnd);
    }
}
public static class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("shell32.dll")] public static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string appID);
    [DllImport("shell32.dll")] public static extern int GetCurrentProcessExplicitAppUserModelID(out IntPtr AppID);
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll")] public static extern bool AllocConsole();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lenNeeded);
    public static string ProcContext() {
        StringBuilder sb = new StringBuilder();
        try { IntPtr a; int hr = GetCurrentProcessExplicitAppUserModelID(out a); string s = (hr == 0 && a != IntPtr.Zero) ? Marshal.PtrToStringUni(a) : ("(none hr=0x" + hr.ToString("X") + ")"); sb.Append("AUMID=").Append(s); } catch (Exception e) { sb.Append("AUMID_ERR=").Append(e.Message); }
        try { IntPtr ws = GetProcessWindowStation(); StringBuilder n = new StringBuilder(256); int need; GetUserObjectInformation(ws, 2, n, 256, out need); sb.Append(" | WINSTA=").Append(n.ToString()); } catch (Exception e) { sb.Append(" | WINSTA_ERR=").Append(e.Message); }
        try { sb.Append(" | CONSOLE=").Append(GetConsoleWindow() != IntPtr.Zero ? "yes" : "no"); } catch {}
        try { sb.Append(" | SESSION=").Append(Process.GetCurrentProcess().SessionId); } catch {}
        try { sb.Append(" | INTERACTIVE=").Append(Environment.UserInteractive); } catch {}
        try { WindowsPrincipal wp = new WindowsPrincipal(WindowsIdentity.GetCurrent()); sb.Append(" | ELEVATED=").Append(wp.IsInRole(WindowsBuiltInRole.Administrator)); } catch (Exception e) { sb.Append(" | ELEVATED_ERR=").Append(e.Message); }
        return sb.ToString();
    }
    public static bool ForceForeground(IntPtr hwnd) {
        IntPtr fg = GetForegroundWindow();
        uint pid; uint fgt = GetWindowThreadProcessId(fg, out pid);
        uint mine = GetCurrentThreadId();
        bool attached = false;
        if (fgt != 0 && fgt != mine) { attached = AttachThreadInput(mine, fgt, true); }
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        ShowWindow(hwnd, 5); BringWindowToTop(hwnd); bool ok = SetForegroundWindow(hwnd);
        if (attached) { AttachThreadInput(mine, fgt, false); }
        return ok;
    }
    public static bool IsForeground(IntPtr hwnd) { return GetForegroundWindow() == hwnd; }
}
'@
    Add-Type -TypeDefinition $iface -Language CSharp | Out-Null
    Emit 'STEP2_OK interop-type'
    try { Emit ('CTX: ' + [Win32]::ProcContext()) } catch { Emit ('CTX_ERR: ' + $_.Exception.Message) }
    try { $pp = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId; $ppn = (Get-Process -Id $pp -ErrorAction SilentlyContinue).ProcessName; $cv = [Win32]::IsWindowVisible([Win32]::GetConsoleWindow()); Emit ('CTX2: PARENT=' + $ppn + '(' + $pp + ') | CONSOLE_VISIBLE=' + $cv) } catch { Emit ('CTX2_ERR: ' + $_.Exception.Message) }
    try { $cw2 = [Win32]::GetConsoleWindow(); if ($cw2 -ne [IntPtr]::Zero) { [Win32]::SetWindowPos($cw2, [IntPtr]::Zero, -32000, -32000, 100, 100, 0x14) | Out-Null; [Win32]::ShowWindow($cw2, 4) | Out-Null }; Emit ('CONSOLE_VISIBLE_NOW=' + [Win32]::IsWindowVisible([Win32]::GetConsoleWindow())) } catch { Emit ('CONVIS_ERR: ' + $_.Exception.Message) }
    [void][Windows.ApplicationModel.DataTransfer.DataTransferManager, Windows.ApplicationModel.DataTransfer, ContentType=WindowsRuntime]
    [void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
    [void][Windows.Foundation.AsyncStatus, Windows.Foundation, ContentType=WindowsRuntime]
    Emit 'STEP3_OK winrt-projections'
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    function Await($op, $t) { $m = $asTaskGeneric.MakeGenericMethod($t); $task = $m.Invoke($null, @($op)); $task.Wait(-1) | Out-Null; return $task.Result }
    $script:form = New-Object System.Windows.Forms.Form
    $script:form.Text = ' '
    $script:form.StartPosition = 'CenterScreen'; $script:form.TopMost = $true
    $script:form.Width = 560; $script:form.Height = 760
    $script:form.BackColor = [System.Drawing.Color]::FromArgb(32,32,32)
    $lbl = New-Object System.Windows.Forms.Label; $lbl.Dock = 'Fill'; $lbl.BackColor = [System.Drawing.Color]::FromArgb(32,32,32); $script:form.Controls.Add($lbl)
    $script:form.Show(); $script:form.Activate(); [System.Windows.Forms.Application]::DoEvents()
    $hwnd = $script:form.Handle
    try { [Win32]::ForceForeground($hwnd) | Out-Null } catch {}
    $factory = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal]::GetActivationFactory([Windows.ApplicationModel.DataTransfer.DataTransferManager])
    Emit 'STEP4_OK factory'
    $iid = [Guid]'a5caee9b-8708-49d1-8d36-67d25a8da00c'
    $dtm = [JouyaDtm]::GetForWindow($factory, $hwnd, $iid)
    Emit 'STEP5_OK dtm-for-window'
    $script:shareFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($FilePath)) ([Windows.Storage.StorageFile])
    if (-not $script:shareFile) { throw 'storagefile-null' }
    try { Emit ('FILE_NAME: ' + $script:shareFile.Name) } catch {}
    Emit 'STEP6_OK storagefile'
    $null = $dtm.add_DataRequested({
        param($s, $e)
        $def = $null
        try {
            $req = $e.Request
            $def = $req.GetDeferral()
            $req.Data.Properties.Title = $script:shareTitle
            $lst = New-Object 'System.Collections.Generic.List[Windows.Storage.IStorageItem]'
            $lst.Add($script:shareFile)
            $req.Data.SetStorageItems($lst)
        } catch { }
        finally { if ($def) { try { $def.Complete() } catch {} } }
    })
    $script:chosen = $false
    try { $null = $dtm.add_TargetApplicationChosen({ param($s, $e) $script:chosen = $true; try { Emit ('TARGET_CHOSEN: ' + $e.ApplicationName) } catch {} }) } catch {}
    Emit 'STEP7_OK handler'
    $fgok = $false
    try { $fgok = [Win32]::ForceForeground($hwnd) } catch {}
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.Application]::DoEvents()
    $fgmatch = $false; try { $fgmatch = [Win32]::IsForeground($hwnd) } catch {}
    Emit ('FG_OK: ' + $fgok + ' | FG_MATCH: ' + $fgmatch)
    Start-Sleep -Milliseconds 150
    [JouyaDtm]::ShowUI($factory, $hwnd)
    Emit 'SHARE_OK'
    Start-Sleep -Milliseconds 500; [System.Windows.Forms.Application]::DoEvents()
    $panelHwnd = [Win32]::GetForegroundWindow(); if ($panelHwnd -eq $hwnd) { $panelHwnd = [IntPtr]::Zero }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $chosenAt = $null
    $panelWasUp = $false; $panelGoneAt = $null
    while ($sw.Elapsed.TotalSeconds -lt 90.0) {
        [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50
        if ($script:form.IsDisposed) { break }
        if ($panelHwnd -ne [IntPtr]::Zero) {
            if ([Win32]::IsWindowVisible($panelHwnd)) { $panelWasUp = $true; $panelGoneAt = $null }
            elseif ($panelWasUp) {
                if (-not $panelGoneAt) { $panelGoneAt = [DateTime]::UtcNow; try { $script:form.TopMost = $false } catch {}; try { $script:form.Opacity = 0 } catch {}; try { [Win32]::ShowWindow($hwnd, 0) | Out-Null } catch {} }
                elseif ((([DateTime]::UtcNow - $panelGoneAt)).TotalSeconds -gt 5) { break }
            }
        }
    }
    try { $script:form.Close(); $script:form.Dispose() } catch {}
} catch {
    Emit ('SHARE_ERR: ' + $_.Exception.GetType().Name + ' | ' + $_.Exception.Message)
    try { if ($script:form) { $script:form.Close(); $script:form.Dispose() } } catch {}
}