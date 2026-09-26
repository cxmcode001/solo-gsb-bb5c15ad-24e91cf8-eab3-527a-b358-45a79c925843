'use strict';

const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MIN_SEGMENTS = 1;
const MAX_SEGMENTS = 50;

const stageRowsBox = document.getElementById('stage-rows');
const segmentRowsBox = document.getElementById('segment-rows');
const form = document.getElementById('reciprocate-form');
const formError = document.getElementById('form-error');
const resultPanel = document.getElementById('result-panel');
const resultSummary = document.getElementById('result-summary');
const verdictAlert = document.getElementById('verdict-alert');
const resultDetail = document.getElementById('result-detail');

const EXAMPLE_STAGES = [
  { driveTeeth: 20, drivenTeeth: 40, width: '1/4', gap: '1/8' },
  { driveTeeth: 24, drivenTeeth: 36, width: '1/6', gap: '0' },
];
const EXAMPLE_SEGMENTS = ['3', '-3/2', '0', '5/2', '-1'];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------- 级行（齿数 + 齿隙宽度 + 初始间隙位置） ---------------- */

function addStageRow(driveTeeth = '', drivenTeeth = '', width = '', gap = '') {
  const row = el('div', 'lash-row');
  row.innerHTML = `
    <span class="stage-index"></span>
    <input class="stage-drive-input" type="number" min="1" max="100000" step="1" placeholder="主动齿数" value="${driveTeeth}" />
    <input class="stage-driven-input" type="number" min="1" max="100000" step="1" placeholder="从动齿数" value="${drivenTeeth}" />
    <input class="lash-width-input" type="text" inputmode="decimal" placeholder="如 1/4、0.25" value="${width}" />
    <input class="lash-gap-input" type="text" inputmode="decimal" placeholder="如 0、1/8" value="${gap}" />
    <button type="button" class="btn danger-ghost" title="删除该级">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (stageRowsBox.querySelectorAll('.lash-row').length <= MIN_STAGES) {
      alert(`至少保留 ${MIN_STAGES} 级`);
      return;
    }
    row.remove();
    refreshStageIndex();
  });
  stageRowsBox.appendChild(row);
  refreshStageIndex();
}

function refreshStageIndex() {
  const rows = [...stageRowsBox.querySelectorAll('.lash-row')];
  rows.forEach((r, i) => {
    r.querySelector('.stage-index').textContent = `第 ${i + 1} 级（轴 ${i + 1} → 轴 ${i + 2}）`;
  });
}

document.getElementById('btn-stage-add').addEventListener('click', () => {
  if (stageRowsBox.querySelectorAll('.lash-row').length >= MAX_STAGES) {
    alert(`最多 ${MAX_STAGES} 级`);
    return;
  }
  addStageRow();
});

/* ---------------- 段行（有符号输入转数） ---------------- */

function addSegmentRow(value = '') {
  const row = el('div', 'gear-row');
  row.innerHTML = `
    <span class="stage-index seg-index"></span>
    <input class="seg-turns-input" type="text" inputmode="decimal" placeholder="如 3、-1/2、0.25、0" value="${value}" />
    <button type="button" class="btn danger-ghost" title="删除该段">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (segmentRowsBox.querySelectorAll('.gear-row').length <= MIN_SEGMENTS) {
      alert(`至少保留 ${MIN_SEGMENTS} 段`);
      return;
    }
    row.remove();
    refreshSegmentIndex();
  });
  segmentRowsBox.appendChild(row);
  refreshSegmentIndex();
}

function refreshSegmentIndex() {
  const rows = [...segmentRowsBox.querySelectorAll('.gear-row')];
  rows.forEach((r, i) => {
    r.querySelector('.seg-index').textContent = `第 ${i + 1} 段`;
  });
}

document.getElementById('btn-segment-add').addEventListener('click', () => {
  if (segmentRowsBox.querySelectorAll('.gear-row').length >= MAX_SEGMENTS) {
    alert(`最多 ${MAX_SEGMENTS} 段`);
    return;
  }
  addSegmentRow();
});

document.getElementById('btn-example').addEventListener('click', () => {
  stageRowsBox.innerHTML = '';
  EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth, s.width, s.gap));
  segmentRowsBox.innerHTML = '';
  EXAMPLE_SEGMENTS.forEach((v) => addSegmentRow(v));
});

/* 初始：示例数据 */
EXAMPLE_STAGES.forEach((s) => addStageRow(s.driveTeeth, s.drivenTeeth, s.width, s.gap));
EXAMPLE_SEGMENTS.forEach((v) => addSegmentRow(v));

/* ---------------- 采集与校验 ---------------- */

const SIGNED_FRAC_RE = /^[+-]?(\d+|\d+\/\d+|\d*\.\d+)$/;
const NONNEG_FRAC_RE = /^(\d+|\d+\/\d+|\d*\.\d+)$/;

function collectStages() {
  const rows = [...stageRowsBox.querySelectorAll('.lash-row')];
  if (rows.length < MIN_STAGES || rows.length > MAX_STAGES) {
    throw new Error(`级数需为 ${MIN_STAGES}～${MAX_STAGES} 级`);
  }
  return rows.map((row, i) => {
    const drive = Number(row.querySelector('.stage-drive-input').value.trim());
    const driven = Number(row.querySelector('.stage-driven-input').value.trim());
    if (!Number.isInteger(drive) || drive < 1) {
      throw new Error(`第 ${i + 1} 级主动齿数需为正整数`);
    }
    if (!Number.isInteger(driven) || driven < 1) {
      throw new Error(`第 ${i + 1} 级从动齿数需为正整数`);
    }
    const width = row.querySelector('.lash-width-input').value.trim();
    const gap = row.querySelector('.lash-gap-input').value.trim();
    if (!NONNEG_FRAC_RE.test(width)) {
      throw new Error(`第 ${i + 1} 级齿隙宽度 w 格式不正确：填非负分数 p/q（如 1/4）或小数（如 0.25），无齿隙填 0`);
    }
    if (!NONNEG_FRAC_RE.test(gap)) {
      throw new Error(`第 ${i + 1} 级初始间隙位置 g 格式不正确：填非负分数 p/q（如 1/8）或小数（如 0.125），无间隙填 0`);
    }
    return { driveTeeth: drive, drivenTeeth: driven, backlashWidth: width, initialGap: gap };
  });
}

function collectSegments() {
  const rows = [...segmentRowsBox.querySelectorAll('.gear-row')];
  if (rows.length < MIN_SEGMENTS || rows.length > MAX_SEGMENTS) {
    throw new Error(`分段数需为 ${MIN_SEGMENTS}～${MAX_SEGMENTS} 段`);
  }
  return rows.map((row, i) => {
    const v = row.querySelector('.seg-turns-input').value.trim();
    if (!SIGNED_FRAC_RE.test(v)) {
      throw new Error(`第 ${i + 1} 段输入转数格式不正确：填有符号分数（如 -1/2）或小数（如 0.25），停顿填 0`);
    }
    return v;
  });
}

/* ---------------- 结果渲染 ---------------- */

function fracText(f) {
  return `${f.num}/${f.den} ≈ ${f.decimal}`;
}

function fracShort(f) {
  return f.den === '1' ? f.num : `${f.num}/${f.den}`;
}

function renderStageTable(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '① 传动参数与初始齿隙状态（负齿数比 = −主动/从动，外啮合换向）'));
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      <th>级</th><th>齿数（主动/从动）</th><th>负齿数比</th>
      <th>齿隙宽度 w（转）</th><th>初始间隙 g（转）</th>
    </tr></thead>`;
  const tbody = el('tbody');
  data.stages.forEach((st) => {
    const tr = el('tr');
    tr.innerHTML = `
      <td>第 ${st.stage} 级</td>
      <td class="frac">${st.driveTeeth} / ${st.drivenTeeth}</td>
      <td class="frac">${fracText(st.stageRatio)}</td>
      <td class="frac">${fracText(st.backlashWidth)}</td>
      <td class="frac">${fracText(st.initialGap)}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderReplayTable(data) {
  const wrap = el('div');
  wrap.appendChild(
    el('h3', 'block-title', '② 逐段回放（各轴实际位移与累计位移、各级剩余间隙位置，单位：转）'),
  );
  const scroll = el('div', 'table-scroll');
  const table = el('table', 'pairs');
  let headHtml = '<thead><tr><th>段</th><th>输入转数</th>';
  for (let a = 1; a <= data.axisCount; a++) {
    headHtml += `<th>轴 ${a} 实际位移<br/>（累计）</th>`;
  }
  for (let k = 1; k <= data.stageCount; k++) {
    headHtml += `<th>第 ${k} 级<br/>剩余间隙</th>`;
  }
  headHtml += '</tr></thead>';
  table.innerHTML = headHtml;
  const tbody = el('tbody');
  data.segments.forEach((seg) => {
    const tr = el('tr');
    let cells = `<td>第 ${seg.segment} 段</td><td class="frac">${fracText(seg.inputTurns)}</td>`;
    seg.axes.forEach((ax) => {
      cells +=
        `<td class="frac">${fracText(ax.actual)}<br/>` +
        `<span class="cell-cum">累计 ${fracText(ax.cumulative)}</span></td>`;
    });
    seg.stages.forEach((st) => {
      cells += `<td class="frac">${fracText(st.gapAfter)}</td>`;
    });
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

function renderFinal(data) {
  const wrap = el('div');
  wrap.appendChild(el('h3', 'block-title', '③ 回放终态（各轴累计位移与各级剩余间隙位置，单位：转）'));
  const scroll = el('div', 'table-scroll');
  const table = el('table', 'pairs');
  table.innerHTML = `
    <thead><tr>
      ${data.finalCumulative.map((ax) => `<th>轴 ${ax.axis}（${ax.role}）<br/>累计位移</th>`).join('')}
      ${data.finalGaps.map((g) => `<th>第 ${g.stage} 级<br/>剩余间隙</th>`).join('')}
    </tr></thead>`;
  const tbody = el('tbody');
  const tr = el('tr');
  tr.innerHTML =
    data.finalCumulative.map((ax) => `<td class="frac">${fracText(ax.cumulative)}</td>`).join('') +
    data.finalGaps.map((g) => `<td class="frac">${fracText(g.gap)}</td>`).join('');
  tbody.appendChild(tr);
  table.appendChild(tbody);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

/* ---------------- 提交 ---------------- */

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formError.hidden = true;
  resultPanel.hidden = true;

  let payload;
  try {
    payload = { stages: collectStages(), segments: collectSegments() };
  } catch (e) {
    formError.textContent = e.message;
    formError.hidden = false;
    return;
  }

  try {
    const resp = await fetch('/api/reciprocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '回放计算失败');

    resultPanel.hidden = false;
    resultDetail.innerHTML = '';

    const lastCum = data.finalCumulative[data.finalCumulative.length - 1].cumulative;
    resultSummary.textContent =
      `${data.stageCount} 级传动 / ${data.axisCount} 个轴 · 回放 ${data.segmentCount} 段 · ` +
      `输出轴累计位移 ${fracShort(lastCum)} 转`;

    verdictAlert.hidden = false;
    verdictAlert.className = 'alert ok';
    verdictAlert.textContent = data.message;

    resultDetail.appendChild(renderStageTable(data));
    resultDetail.appendChild(renderReplayTable(data));
    resultDetail.appendChild(renderFinal(data));
  } catch (e) {
    resultPanel.hidden = false;
    resultDetail.innerHTML = '';
    resultSummary.textContent = '';
    verdictAlert.hidden = false;
    verdictAlert.className = 'alert error';
    verdictAlert.textContent = `请求出错：${e.message}`;
  }
});
