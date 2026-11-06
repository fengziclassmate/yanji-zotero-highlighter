param([Parameter(Mandatory=$true)][string]$RequestPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class YanjiReaderWin {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll",EntryPoint="SendMessageW",CharSet=CharSet.Unicode)] public static extern IntPtr SetText(IntPtr h,uint m,IntPtr w,string text);
 [DllImport("user32.dll",EntryPoint="SendMessageW",CharSet=CharSet.Unicode)] public static extern IntPtr GetText(IntPtr h,uint m,IntPtr w,StringBuilder text);
 [DllImport("user32.dll",EntryPoint="SendMessageW")] public static extern IntPtr Click(IntPtr h,uint m,IntPtr w,IntPtr l);
 public static IntPtr[] Windows(){var rows=new List<IntPtr>();EnumWindows((h,p)=>{rows.Add(h);return true;},IntPtr.Zero);return rows.ToArray();}
 public static string Class(IntPtr h){var s=new StringBuilder(200);GetClassName(h,s,200);return s.ToString();}
 public static bool OwnedBy(IntPtr dialog,IntPtr browser){for(int i=0;i<8&&dialog!=IntPtr.Zero;i++){dialog=GetWindow(dialog,4);if(dialog==browser||GetAncestor(dialog,2)==browser)return true;}return false;}
 public static string Text(IntPtr h){var s=new StringBuilder(8192);GetText(h,13,(IntPtr)8192,s);return s.ToString();}
}
'@
$scope=[System.Windows.Automation.TreeScope]::Descendants
function Find-ReaderControl($window,[string]$id){
 $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$id)
 return $window.FindFirst($scope,$condition)
}
function Test-ReaderAddress([string]$actual,[Uri]$expected){
 if(-not($actual -match '^https?://')){$actual=$expected.Scheme+'://'+$actual}
 $parsed=$null
 if(-not[Uri]::TryCreate($actual,[UriKind]::Absolute,[ref]$parsed)){return $false}
 return [Uri]::Compare($parsed,$expected,[UriComponents]::SchemeAndServer-bor[UriComponents]::PathAndQuery,[UriFormat]::UriEscaped,[StringComparison]::Ordinal)-eq0
}
function Get-ReaderAddress($window){
 $address=Find-ReaderControl $window 'view_1017'
 if(-not$address){return ''}
 return $address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
}
function Get-ReaderSaveDialog($before,[IntPtr]$browser,[string]$pii){
 $found=@()
 foreach($handle in [YanjiReaderWin]::Windows()){
  if($before-contains$handle-or[YanjiReaderWin]::Class($handle)-ne'#32770'){continue}
  [uint32]$ownerPID=0;[void][YanjiReaderWin]::GetWindowThreadProcessId($handle,[ref]$ownerPID)
  if((Get-Process -Id $ownerPID -ErrorAction Stop).ProcessName-ne'msedge'){continue}
  $dialog=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $nodes=$dialog.FindAll($scope,[System.Windows.Automation.Condition]::TrueCondition)
  $edit=$nodes|Where-Object {$_.Current.ClassName-eq'Edit'-and$_.Current.AutomationId-in@('1001','1148')}|Select-Object -First 1
  $save=$nodes|Where-Object {$_.Current.ClassName-eq'Button'-and$_.Current.AutomationId-eq'1'}|Select-Object -First 1
  if(-not$edit-or-not$save){continue}
  $suggested=[YanjiReaderWin]::Text([IntPtr]$edit.Current.NativeWindowHandle)
  if(-not[YanjiReaderWin]::OwnedBy($handle,$browser)-and(-not$pii-or$suggested-notmatch[Regex]::Escape($pii))){continue}
  $found+=@{Handle=$handle;Edit=$edit;Save=$save}
 }
 if($found.Count-gt1){throw '出现多个匹配的保存窗口，请关闭多余窗口后重试。'}
 if($found.Count-eq1){return $found[0]}
 return $null
}
function Test-ReaderOutput([string]$path){
 if(-not[IO.File]::Exists($path)){return $false}
 $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 try{
  if($stream.Length-lt20){return $false}
  $header=New-Object byte[] ([Math]::Min(1024,$stream.Length));[void]$stream.Read($header,0,$header.Length)
  $size=[Math]::Min(4096,$stream.Length);[void]$stream.Seek(-$size,[IO.SeekOrigin]::End)
  $tail=New-Object byte[] $size;[void]$stream.Read($tail,0,$tail.Length)
  return [Text.Encoding]::ASCII.GetString($header).Contains('%PDF-')-and[Text.Encoding]::ASCII.GetString($tail).Contains('%%EOF')
 }finally{$stream.Dispose()}
}
function Invoke-ReaderSave($request){
 $expected=$null
 if(-not[Uri]::TryCreate($request.url,[UriKind]::Absolute,[ref]$expected)-or$expected.Scheme-notin@('http','https')-or$expected.UserInfo){throw 'PDF 地址无效。'}
 $output=[IO.Path]::GetFullPath($request.outputPath)
 if([IO.File]::Exists($output)){throw 'PDF 临时保存位置已存在文件，已停止。'}
 $readers=@()
 foreach($handle in [YanjiReaderWin]::Windows()){
  if([YanjiReaderWin]::Class($handle)-ne'Chrome_WidgetWin_1'){continue}
  [uint32]$ownerPID=0;[void][YanjiReaderWin]::GetWindowThreadProcessId($handle,[ref]$ownerPID)
  if((Get-Process -Id $ownerPID -ErrorAction Stop).ProcessName-ne'msedge'){continue}
  $window=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if(Test-ReaderAddress (Get-ReaderAddress $window) $expected){$readers+=@{Handle=$handle;Window=$window}}
 }
 if($readers.Count-gt1){$foregroundReaders=@($readers|Where-Object {$_.Handle-eq[YanjiReaderWin]::GetForegroundWindow()});if($foregroundReaders.Count-eq1){$readers=$foregroundReaders}}
 if($readers.Count-ne1){throw '请保持对应 PDF 在 Edge 中打开；未找到唯一的 PDF 阅读窗口。'}
 $reader=$readers[0];$button=$null;$readyUntil=[DateTime]::UtcNow.AddSeconds(10)
 do{
  if(-not(Test-ReaderAddress (Get-ReaderAddress $reader.Window) $expected)){throw 'PDF 页面已切换，已停止保存。'}
  $button=Find-ReaderControl $reader.Window 'documentDownload'
  if(-not$button){$button=Find-ReaderControl $reader.Window 'download'}
  if(-not$button){$button=Find-ReaderControl $reader.Window 'save'}
  if($button-and$button.Current.IsEnabled){break}
  Start-Sleep -Milliseconds 200
 }while([DateTime]::UtcNow-lt$readyUntil)
 if(-not$button-or-not$button.Current.IsEnabled){throw 'PDF 阅读器尚未准备好，请等待 PDF 显示后重试。'}
 $before=[YanjiReaderWin]::Windows();$pii=''
 if($expected.AbsolutePath-match'/1-s2\.0-([^/]+)/main\.pdf$'){$pii=$Matches[1]}
 if(-not(Test-ReaderAddress (Get-ReaderAddress $reader.Window) $expected)){throw 'PDF 页面已切换，已停止保存。'}
 $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
 $dialog=$null
 for($i=0;$i-lt80-and-not$dialog;$i++){Start-Sleep -Milliseconds 100;$dialog=Get-ReaderSaveDialog $before $reader.Handle $pii}
 if(-not$dialog){throw '阅读器未显示可识别的保存窗口，请确认 PDF 已加载且没有其他对话框。'}
 if(-not(Test-ReaderAddress (Get-ReaderAddress $reader.Window) $expected)){throw 'PDF 页面已切换，已停止保存。'}
 $editHandle=[IntPtr]$dialog.Edit.Current.NativeWindowHandle;$saveHandle=[IntPtr]$dialog.Save.Current.NativeWindowHandle
 if([YanjiReaderWin]::GetAncestor($editHandle,2)-ne$dialog.Handle-or[YanjiReaderWin]::GetAncestor($saveHandle,2)-ne$dialog.Handle){throw 'PDF 保存窗口已变化，已停止。'}
 [void][YanjiReaderWin]::SetText($editHandle,12,[IntPtr]::Zero,$output)
 if([YanjiReaderWin]::Text($editHandle)-ne$output){throw 'PDF 保存路径未能核对，已停止。'}
 [void][YanjiReaderWin]::Click($saveHandle,245,[IntPtr]::Zero,[IntPtr]::Zero)
 $until=[DateTime]::UtcNow.AddSeconds(35);$previous=-1
 do{
  Start-Sleep -Milliseconds 250
  if(Test-ReaderOutput $output){$size=([IO.FileInfo]$output).Length;if($size-eq$previous){return};$previous=$size}
 }while([DateTime]::UtcNow-lt$until)
 throw 'PDF 阅读器尚未完成文件保存，请确认文档已完整加载。'
}
if($MyInvocation.InvocationName-ne'.'){
 $request=[IO.File]::ReadAllText($RequestPath,[Text.Encoding]::UTF8)|ConvertFrom-Json
 try{Invoke-ReaderSave $request;$result=@{ok=$true}}
 catch{$result=@{ok=$false;error=$_.Exception.Message}}
 [IO.File]::WriteAllText($request.resultPath,($result|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
 if(-not$result.ok){exit 1}
}
