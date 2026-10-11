# -*- coding: utf-8 -*-
"""
tools/gen-gbk-table.py —— 生成 lib/gbk-table.js（GBK → Unicode 解码表）

为什么要有它：UXP 里**没有 TextDecoder**（v0.3.9 S39 三处位置都查过），
宿主文本读又是 UTF-8 语义（GBK 字节会被换成 U+FFFD），而中文 Windows 的
Excel / WPS「另存为 CSV」默认就是 ANSI(GBK) ⇒ 只能自己做解码。

做法：按 GBK 区位建一张**平面表**：
  金字节 0x81–0xFE（126 个）× 尾字节 0x40–0xFE（跳过 0x7F ⇒ 190 个）= 23,940 槽位
  没映射的槽位存 U+FFFD ⇒ 解码就是一次 charAt，无分支表、无依赖。

⚠️ 权威来源是 Python 的 `gbk` codec。**不要用自己生成的表去验自己的解码器**
   （编码解码共用同一个错误索引会永远自洽 —— v0.3.9 就是这么差点漏掉一个
   把步长写成 191（真值 190）的 bug）。

用法：python tools/gen-gbk-table.py
"""
import io, json, os

chars = []
for lead in range(0x81, 0xFF):
    for trail in range(0x40, 0xFF):
        if trail == 0x7F:
            continue
        try:
            chars.append(bytes([lead, trail]).decode("gbk"))
        except Exception:
            chars.append("\uFFFD")

assert len(chars) == 23940, len(chars)

header = (
    "/* lib/gbk-table.js —— 由 tools/gen-gbk-table.py 生成，**不要手改**\n"
    " * GBK → Unicode 平面表：金字节 0x81-0xFE x 尾字节 0x40-0xFE（跳过 0x7F）= 23940 槽位。\n"
    " * 索引 = (lead - 0x81) * 190 + (trail < 0x7F ? trail - 0x40 : trail - 0x41)\n"
    " * 没映射的槽位是 U+FFFD。权威来源：Python 的 gbk codec。\n"
    " */\n"
)
body = "module.exports = " + json.dumps("".join(chars), ensure_ascii=False) + ";\n"

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vellum-toolbox", "lib", "gbk-table.js")
io.open(out, "w", encoding="utf-8", newline="\n").write(header + body)
print("写出 %s  %d 字节　槽位 %d" % (out, os.path.getsize(out), len(chars)))
