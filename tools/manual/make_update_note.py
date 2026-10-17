# -*- coding: utf-8 -*-
"""
生成「v0.7.0 → v0.9.37 更新说明」单文件 HTML。

为什么单独做一份：主手册是"全量说明书"，同事想知道"这版到底变了啥"时翻它太重。
这份按版本讲，一屏一节，图片全部内联（单文件，发出去就能看，不依赖 images/ 目录）。

⚠️ 图片尺寸刻意压到 230px 宽：面板截图都是 422×732 的竖图，
   放满了会变成一条很高的长条，滑半天看不到下一节。230 宽 ⇒ 高约 399，一屏一节刚好。
"""
import base64
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/manual → 仓库根
IMG = os.path.join(ROOT, "docs", "manual", "images")
OUT = os.path.join(ROOT, "docs", "update", "v0.9.37-更新说明.html")


def b64(name):
    p = os.path.join(IMG, name)
    if not os.path.exists(p):
        raise SystemExit("缺图：" + p)
    with open(p, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")


CSS = """
*{box-sizing:border-box}
body{margin:0;background:#f7f7f9;color:#1f2430;
  font-family:"Microsoft YaHei","PingFang SC",system-ui,-apple-system,sans-serif;
  font-size:14px;line-height:1.75;}
.wrap{max-width:960px;margin:0 auto;padding:0 28px 80px;}

/* ---- 头部 ---- */
header{background:linear-gradient(160deg,#101827 0%,#1b2536 100%);color:#e8ecf3;
  padding:44px 0 38px;margin-bottom:34px;}
header .wrap{padding-bottom:0;}
.kick{font-size:11px;letter-spacing:.22em;color:#7f93b0;text-transform:uppercase;margin-bottom:10px;}
h1{margin:0 0 12px;font-size:27px;line-height:1.35;font-weight:700;letter-spacing:.01em;}
.vtag{display:inline-block;background:#2b6cf6;color:#fff;font-size:12px;font-weight:700;
  padding:3px 10px;border-radius:999px;vertical-align:3px;margin-left:8px;letter-spacing:.02em;}
.lede{font-size:14.5px;color:#b9c5d6;max-width:660px;margin:0;}
.meta{margin-top:20px;font-size:12px;color:#8496ad;}
.meta b{color:#c8d4e4;font-weight:600;}

/* ---- 三条大字 ---- */
.high{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:0 0 40px;}
.high>div{background:#fff;border:1px solid #e3e6ec;border-radius:11px;padding:16px 17px;}
.high .n{font-size:11px;font-weight:700;color:#2b6cf6;letter-spacing:.1em;margin-bottom:6px;}
.high .t{font-size:14.5px;font-weight:700;margin-bottom:5px;line-height:1.5;}
.high .d{font-size:12.5px;color:#5c6577;line-height:1.65;}

/* ---- 版本节 ---- */
.sec{background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:24px 26px;
  margin:0 0 22px;}
.sec h2{margin:0 0 4px;font-size:18px;font-weight:700;letter-spacing:.01em;}
.sec h2 .badge{font-size:11px;font-weight:700;color:#fff;background:#94a3b8;
  padding:2px 8px;border-radius:5px;margin-right:9px;vertical-align:2px;letter-spacing:.02em;}
.sec h2 .badge.new{background:#16a34a;}
.sec h2 .badge.chg{background:#2b6cf6;}
.basis{font-size:12.5px;color:#8a94a6;margin:0 0 16px;}

/* ---- 左文右图 ---- */
/* align-items:center 而不是 start：左文常常比竖图矮，用 start 会在左下角空出一大块，
   看着像"没写完"。居中之后空白上下均分，像刻意的留白。 */
.split{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:26px;align-items:center;}
.split figure{margin:0;}
.split img{width:100%;display:block;border-radius:7px;border:1px solid #dfe3ea;background:#0f1014;}
figcaption{font-size:11.5px;color:#8a94a6;margin-top:7px;line-height:1.6;}

/* ---- 前后对照 ---- */
.before-after{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 4px;}
.ba{background:#f7f8fa;border:1px solid #e8ebf0;border-radius:8px;padding:11px 13px;font-size:12.5px;}
.ba .h{font-size:11px;font-weight:700;color:#8a94a6;letter-spacing:.06em;margin-bottom:5px;}
.ba.now{background:#f0f7f2;border-color:#d6e9dc;}
.ba.now .h{color:#3f8a5a;}
.ba ul{margin:0;padding-left:16px;}
.ba li{margin:2px 0;}

ul.plain{margin:8px 0;padding-left:19px;}
ul.plain li{margin:5px 0;}
ul.plain li b{color:#111827;}

code{background:#eef1f6;border-radius:4px;padding:1px 5px;font-size:12.5px;
  font-family:Consolas,Monaco,monospace;}

/* ---- 提示条 ---- */
.tip{border-left:3px solid #2b6cf6;background:#f2f6ff;border-radius:0 8px 8px 0;
  padding:11px 14px;margin:14px 0 0;font-size:12.8px;line-height:1.7;}
.tip.warn{border-color:#e08a3c;background:#fff6ec;}
.tip.ok{border-color:#16a34a;background:#f0f7f2;}
.tip .h{display:block;font-weight:700;margin-bottom:3px;color:#111827;}

/* ---- 表格 ---- */
table{border-collapse:collapse;width:100%;font-size:12.8px;margin:12px 0;}
th,td{border:1px solid #e3e6ec;padding:7px 11px;text-align:left;}
th{background:#f5f6f9;font-weight:600;color:#3d4757;}
td.n{font-variant-numeric:tabular-nums;}

/* ---- 结尾 ---- */
.foot{background:#101827;color:#c8d4e4;border-radius:12px;padding:24px 26px;margin-top:30px;}
.foot h3{margin:0 0 10px;font-size:15px;color:#fff;}
.foot ol{margin:0;padding-left:20px;font-size:13px;}
.foot li{margin:6px 0;}
.foot code{background:#232f42;color:#dbe4f0;}

@media (max-width:760px){
  .high{grid-template-columns:1fr;}
  .split{grid-template-columns:1fr;}
  .split figure{max-width:230px;}
  .before-after{grid-template-columns:1fr;}
}
"""

HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vellum 工具箱 v0.9.37 —— 这一版更新了什么</title>
<style>__CSS__</style>
</head>
<body>

<header>
  <div class="wrap">
    <div class="kick">Release Notes</div>
    <h1>Vellum 工具箱 这一版更新了什么<span class="vtag">v0.9.37</span></h1>
    <p class="lede">从上一版 <b>v0.7.0</b> 到现在，中间隔了 v0.8 和 v0.9 两个系列：
      多了<b>三个工具</b>，素材库<b>换了界面</b>，模板库也<b>真正通了</b>。</p>
    <div class="meta">发布日期 2026-10-18　·　装法：下载 <b>com.vellum.toolbox_PS.ccx</b> 双击，然后<b>重启 Photoshop</b>　·　适用 PS 25.0+</div>
  </div>
</header>

<div class="wrap">

  <div class="high">
    <div>
      <div class="n">01</div>
      <div class="t">三个新工具</div>
      <div class="d">出图体检、导出审核版、新建稿 —— 都在首页，点开就能用。</div>
    </div>
    <div>
      <div class="n">02</div>
      <div class="t">素材库换了界面</div>
      <div class="d">置入条挪到面板底部、落点九宫格删掉、目录换成面包屑下钻。</div>
    </div>
    <div>
      <div class="n">03</div>
      <div class="t">模板库通了</div>
      <div class="d">工作台里收录的 PSD 模板，插件里点一下就能开成新稿，参考线都带着。</div>
    </div>
  </div>

  <!-- ============ 1 ============ -->
  <div class="sec">
    <h2><span class="badge chg">改</span>首页变长了：4 行 → 7 行</h2>
    <p class="basis">末尾那行 AI-MCP 还是灰的（没做），其余六行都能点。</p>
    <div class="split">
      <div>
        <p>新加的三行是 <b>④ 出图体检</b>、<b>⑤ 导出审核版</b>、<b>⑥ 新建稿</b>，插在原来的「表格生成」后面。
          号位（↑1 ~ ↑7）是固定的，报问题时说「第 5 行」大家都懂。</p>
        <div class="before-after">
          <div class="ba"><div class="h">以前</div>
            <ul><li>① 调色板</li><li>② 素材库</li><li>③ 表格生成</li><li>④ AI-MCP（灰）</li></ul></div>
          <div class="ba now"><div class="h">现在</div>
            <ul><li>① 调色板　② 素材库　③ 表格生成</li>
            <li><b>④ 出图体检　⑤ 导出审核版　⑥ 新建稿</b></li>
            <li>⑦ AI-MCP（灰）</li></ul></div>
        </div>
      </div>
      <figure><img src="__IMG_HOME__" alt="插件首页，七行入口">
        <figcaption>首页：七行入口，最后一行 AI-MCP 仍是灰的</figcaption></figure>
    </div>
  </div>

  <!-- ============ 2 ============ -->
  <div class="sec">
    <h2><span class="badge chg">改</span>素材库：置入条挪到底部，落点删掉</h2>
    <p class="basis">这一版改得最狠的地方，但用起来更省事。</p>
    <div class="split">
      <div>
        <div class="before-after">
          <div class="ba"><div class="h">以前</div>
            <ul>
              <li>选中素材后，<b>上方</b>弹出 150px 的详情区（含落点九宫格）</li>
              <li>素材一多，要滚回上面才能按「置入」</li>
              <li>格子里那 66px 的九宫格几乎没人用</li>
            </ul></div>
          <div class="ba now"><div class="h">现在</div>
            <ul>
              <li>详情条<b>固定在面板最下面</b>，只占 53px</li>
              <li>网格怎么滚，它都不动</li>
              <li>落点九宫格<b>删了</b>：有选区落选区中心，没选区落画布中心</li>
            </ul></div>
        </div>
        <p><b>白赚约 100px。</b>同样一块面板，一屏能多看到差不多一行素材。</p>
        <div class="tip"><span class="h">详情还是"两行"的</span>
          第一行文件名，第二行尺寸 · 大小 · 角色 · 来源。完整路径和标签收进了鼠标悬停提示里 ——
          平时不占版面，排障时把鼠标停上去还能看到。</div>
      </div>
      <figure><img src="__IMG_SEL__" alt="选中一张素材后的底部详情条">
        <figcaption>选中素材：详情条在面板底部，右侧是「置入」</figcaption></figure>
    </div>
  </div>

  <!-- ============ 3 ============ -->
  <div class="sec">
    <h2><span class="badge chg">改</span>素材库：目录换成面包屑下钻</h2>
    <p class="basis">以前只能表达两级，现在最多 5 层。</p>
    <div class="split">
      <div>
        <ul class="plain">
          <li><b>根层跟以前一样</b>：一列目录行（📁 名字 …… N 项），点一行往下钻一层。</li>
          <li><b>钻进目录后</b>，上面多出一行面包屑，比如 <code>通用库 › 公司素材</code>，点任意一段直接跳回那层。</li>
          <li><b>子目录太多会折叠</b>：超过 3 个收成一行「还有 N 个」，免得一进目录全是文件夹。</li>
        </ul>
        <div class="tip ok"><span class="h">层级多深都不会把网格挤没</span>
          目录区最多占 96px。因为面包屑只占<b>一行</b>，不像以前那样每多一层就多一行。
          这也是为什么敢放开到 5 层。</div>
      </div>
      <figure><img src="__IMG_BC__" alt="素材库：面包屑下钻">
        <figcaption>钻进「公司素材」以后：上面多了面包屑，下面是子目录行</figcaption></figure>
    </div>
  </div>

  <!-- ============ 4 ============ -->
  <div class="sec">
    <h2><span class="badge new">新</span>新建稿：从模板开，或按规范开</h2>
    <p class="basis">首页第 ⑥ 行。以前建稿要在 PS 的「新建」对话框里手输尺寸，现在两个模式。</p>
    <div class="split">
      <div>
        <ul class="plain">
          <li><b>从模板建稿</b>：浏览「PSD 模板」分区，卡片上直接写着品类、成品尺寸、出血、色彩模式。
            选中 → 「打开」→ 在 PS 里开成新稿，<b>参考线是模板里打好的</b>。</li>
          <li><b>按规范建稿</b>：五个常用规格（易拉宝 80×180、展架 60×160、海报 A3/A4、名片 90×54），
            每个自动加 <b>3mm 出血</b>，并在成品边打<b>四条参考线</b>，色彩模式直接是 CMYK。</li>
        </ul>
        <div class="tip warn"><span class="h">⚠️ 打开的是副本，Ctrl+S 会存错地方</span>
          插件把模板拷一份到自己的缓存目录再打开 —— 好处是<b>模板原件绝不会被改坏</b>；
          代价是直接按 Ctrl+S 会存回缓存目录，你以为存进项目了其实没有。
          <b>请用「文件 → 另存为」存到项目目录。</b></div>
      </div>
      <figure><img src="__IMG_TPL__" alt="新建稿 · 从模板建稿">
        <figcaption>从模板建稿：卡片上的缩略图是信息卡，不是 PSD 画面</figcaption></figure>
    </div>
    <table>
      <tr><th style="width:130px">规格</th><th>成品</th><th>dpi</th><th>模式</th><th>建出来的画布</th></tr>
      <tr><td>易拉宝</td><td class="n">800 × 1800 mm</td><td class="n">150</td><td>CMYK</td><td class="n">4760 × 10665 px</td></tr>
      <tr><td>展架</td><td class="n">600 × 1600 mm</td><td class="n">150</td><td>CMYK</td><td class="n">3591 × 9497 px</td></tr>
      <tr><td>海报 A3</td><td class="n">297 × 420 mm</td><td class="n">300</td><td>CMYK</td><td class="n">3579 × 5031 px</td></tr>
      <tr><td>海报 A4</td><td class="n">210 × 297 mm</td><td class="n">300</td><td>CMYK</td><td class="n">2551 × 3579 px</td></tr>
      <tr><td>名片</td><td class="n">90 × 54 mm</td><td class="n">300</td><td>CMYK</td><td class="n">1134 × 709 px</td></tr>
    </table>
    <div class="tip"><span class="h">参考线建完请扫一眼</span>
      四条线打在<b>成品边</b>（离画布边缘正好一个出血量；3mm 在 A3@300dpi 上是 35px，看着几乎贴边）。
      PS 的接口读不到参考线坐标，所以插件只能保证「打了四条」，保证不了「位置对不对」—— 建完瞄一眼。</div>
  </div>

  <!-- ============ 5 ============ -->
  <div class="sec">
    <h2><span class="badge new">新</span>出图体检：出图前先看清参数</h2>
    <p class="basis">首页第 ④ 行。解决的是"发出去才发现是 RGB / 分辨率不够 / 字没转曲"。</p>
    <div class="split">
      <div>
        <ul class="plain">
          <li>一次查 <b>12 项</b>：色彩模式、分辨率、像素尺寸、物理尺寸、位深、颜色配置文件、
            文字是否转曲、字体在不在本机、隐藏图层、元素是否超出画布、出血、有无未保存改动。</li>
          <li>每项标 <b>合格 / 提醒 / 无结论</b> 三档 —— 不会把"查不出来"当成"合格"。</li>
          <li><b>只读</b>：不改图、不删层、不进历史记录。</li>
        </ul>
        <div class="tip warn"><span class="h">它能查参数，查不了"好不好看"</span>
          错字、层级、视觉问题它看不出来。另外两项只给「疑似」：
          字体只知道"在不在本机"，不知道"选得对不对"；出血只能数参考线条数，读不到坐标。</div>
      </div>
      <figure><img src="__IMG_INS__" alt="出图体检页">
        <figcaption>出图体检：每项一行，右边写着判断理由</figcaption></figure>
    </div>
  </div>

  <!-- ============ 6 ============ -->
  <div class="sec">
    <h2><span class="badge new">新</span>导出审核版：带参数条，原稿零改动</h2>
    <p class="basis">首页第 ⑤ 行。给客户 / 领导看版时，最常被问的三件事直接印在图上。</p>
    <div class="split">
      <div>
        <ul class="plain">
          <li><b>图的底部加一条参数条</b>：文件名、导出时间、模式 / 位深 / dpi / 像素尺寸、
            物理尺寸、出血判定、颜色配置、文字是否转曲、素材来源，右上角还有「<b>审核用 · 非成品</b>」角标。</li>
          <li><b>底色跟着画面走</b>：深色稿配深条、浅色稿配浅条，字永远看得清。</li>
          <li><b>大稿自动缩</b>：长边超 4000px 才等比缩小，并把<b>缩放比例印在参数条上</b>，免得看版的人以为是 100%。</li>
        </ul>
        <div class="tip ok"><span class="h">原稿一个像素都不动</span>
          加条、缩放、转色彩模式全打在<b>副本</b>上，导完立刻把副本关掉、切回你的原稿。
          所以导多少次都不会污染原稿 —— 顺手也能解释为什么导完历史记录是空的。</div>
        <div class="tip warn"><span class="h">CMYK 稿是先转 RGB 再导的（只在副本上）</span>
          PS 本身不支持把 CMYK 稿存成 PNG。<b>要交给印刷厂的文件请从原稿另存，不要用审核图。</b></div>
      </div>
      <figure><img src="__IMG_EXP__" alt="导出审核版页">
        <figcaption>导出审核版：上面是体检结论，中间选出血，下面是参数条实样</figcaption></figure>
    </div>
  </div>

  <!-- ============ 结尾 ============ -->
  <div class="foot">
    <h3>怎么装 / 怎么更新</h3>
    <ol>
      <li>下载 <code>com.vellum.toolbox_PS.ccx</code>，<b>双击</b>安装（不用先卸载旧版）。</li>
      <li><b>完全退出 Photoshop 再打开</b>（不是最小化）。</li>
      <li>菜单 <code>增效工具 → Vellum 工具箱</code> 把面板叫出来。</li>
    </ol>
    <p style="margin:12px 0 0;font-size:12.5px;color:#93a3b8">
      更新不会动你的数据：「我的颜色」、表格样式偏好、模板镜像都还在。
      有问题直接把面板左下角那行字截图发出来 —— 那是能直接定位的原始读数。
    </p>
  </div>

</div>
</body>
</html>
"""


def main():
    html = HTML.replace("__CSS__", CSS)
    for key, fn in [
        ("__IMG_HOME__", "01-首页.png"),
        ("__IMG_SEL__", "05-素材库-选中详情.png"),
        ("__IMG_LIB__", "04-素材库-通用库.png"),
        ("__IMG_BC__", "04b-素材库-面包屑.png"),
        ("__IMG_TPL__", "13-新建稿-从模板.png"),
        ("__IMG_INS__", "11-出图体检.png"),
        ("__IMG_EXP__", "12-导出审核.png"),
    ]:
        html = html.replace(key, b64(fn))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("已生成", OUT, "%.0f KB" % (os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
