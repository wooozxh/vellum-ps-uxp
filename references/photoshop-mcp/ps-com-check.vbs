' ============================================================
' Photoshop COM 连通性检测
' 用法：直接双击本文件，会弹出结果对话框。
' 作用：判断本机能否通过 COM 自动化接口连接 Photoshop。
' 只做检测，不修改任何东西。
' ============================================================

On Error Resume Next

Dim app, msg, ver

msg = ""

Set app = CreateObject("Photoshop.Application")

If Err.Number <> 0 Then
    msg = "结果：连接失败" & vbCrLf & vbCrLf & _
          "错误码：" & Err.Number & vbCrLf & _
          "描述：" & Err.Description & vbCrLf & vbCrLf & _
          "可能原因：" & vbCrLf & _
          "  1) Photoshop 没有运行" & vbCrLf & _
          "  2) 调用方处于受限环境（沙箱 / 权限不足）" & vbCrLf & _
          "  3) COM 注册异常，可用管理员执行：" & vbCrLf & _
          "     Photoshop.exe /regserver"
Else
    Err.Clear
    ver = app.DoJavaScript("app.name + ' ' + app.version")
    If Err.Number <> 0 Then
        ver = "已连接，但读取版本失败"
        Err.Clear
    End If
    msg = "结果：连接成功" & vbCrLf & vbCrLf & _
          "Photoshop：" & ver & vbCrLf & vbCrLf & _
          "说明：COM 自动化接口正常，可被外部程序驱动。"
End If

' 结果同时写一份到脚本所在目录，便于留档排查
Err.Clear
Dim fso, f, p
Set fso = CreateObject("Scripting.FileSystemObject")
If Err.Number = 0 Then
    p = fso.GetParentFolderName(WScript.ScriptFullName) & "\ps-com-check-result.txt"
    Set f = fso.CreateTextFile(p, True)
    If Err.Number = 0 Then
        f.WriteLine msg
        f.Close
    End If
End If

MsgBox msg, 64, "Photoshop COM 检测"
