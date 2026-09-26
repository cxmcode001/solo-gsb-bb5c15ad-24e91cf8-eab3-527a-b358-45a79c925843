'use strict';

/**
 * 往复运动回放算法（精确分数，基于 BigInt）
 *
 * 已装好的 1～3 级外啮合齿轮传动：第 k 级主动齿数 z_k、从动齿数 n_k。
 * 外啮合反向：从动轴相对主动轴的位移比为负齿数比 r_k = −z_k / n_k。
 *
 * 第 k 级从动轴侧有固定齿隙宽度 w_k ≥ 0（单位：该级从动轴转数），
 * 间隙位置（游标）g_k ∈ [0, w_k] 表示当前空程所处位置，跨段保留状态。
 *
 * 录入 1～50 段有符号输入转数（输入轴量即输入轴实际位移），逐段按级传递：
 *   d  = 上游实际位移 × r_k          （理想位移，含换向）
 *   u  = g_k + d
 *   g新 = min(w_k, max(0, u))         （游标裁剪在 [0, w_k]）
 *   本级实际位移 = u − g新             （被齿隙吸收后真正传出的位移）
 * 更新 g_k ← g新，本级实际位移作为下一级的上游位移。
 * 各轴累计位移初始为 0，逐段累加该轴实际位移。
 *
 * 零齿隙（w = 0，此时 g 必为 0）时 g新 恒为 0，实际位移 = d，退化为无空程理想传动；
 * 零位移段（转数为 0）时 d = 0、u = g ∈ [0, w]，g新 = g，本级实际位移为 0。
 */

const { makeFrac, parseDecimal, MAX_TEETH } = require('./search');

/** 级数范围 / 分段数范围 / 分数约分后分母上限（10¹²）/ 转数与齿隙取值上限（10¹² 转） */
const MIN_STAGES = 1;
const MAX_STAGES = 3;
const MIN_SEGMENTS = 1;
const MAX_SEGMENTS = 50;
const MAX_FRAC_DEN = 1000000000000n;
const MAX_TURNS = 1000000000000n;

const ZERO = { num: 0n, den: 1n };

function addFrac(a, b) {
  return makeFrac(a.num * b.den + b.num * a.den, a.den * b.den);
}

function subFrac(a, b) {
  return makeFrac(a.num * b.den - b.num * a.den, a.den * b.den);
}

function mulFrac(a, b) {
  return makeFrac(a.num * b.num, a.den * b.den);
}

/** 分数三点裁剪：min(hi, max(lo, f))（约定 lo ≤ hi，分母均为正） */
function clampFrac(f, lo, hi) {
  if (f.num * lo.den < lo.num * f.den) return lo;
  if (f.num * hi.den > hi.num * f.den) return hi;
  return f;
}

/**
 * 解析正整数字段（齿数）：接受 JSON number 或纯数字字符串。
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
function parsePositiveInt(raw, label, max) {
  let v;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      return { ok: false, error: `${label}需为正整数` };
    }
    v = raw;
  } else if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) {
    v = Number(raw.trim());
  } else {
    return { ok: false, error: `${label}需为正整数` };
  }
  if (v < 1 || v > max) {
    return { ok: false, error: `${label}需为 1～${max} 的正整数` };
  }
  return { ok: true, value: v };
}

/**
 * 解析分数字段（转数 / 齿隙）：接受 JSON number 或字符串；
 * 字符串支持分数 p/q（q ≥ 1；允许负值时分子可带符号）或十进制小数（可带符号）；
 * 约分后分母 ≤ 10¹²，|取值| ≤ 10¹² 转。
 * @param {*} raw
 * @param {string} label 字段名（用于错误提示）
 * @param {boolean} allowNegative 是否允许负值（输入转数允许，齿隙宽度 / 间隙位置不允许）
 * @returns {{ok:true,frac:object}|{ok:false,error:string}}
 */
function parseFracValue(raw, label, allowNegative) {
  const hint = allowNegative
    ? '请填有符号分数（如 -1/2、3/4）或小数（如 -0.5、2.5），停顿填 0'
    : '请填非负分数 p/q（如 1/8）或小数（如 0.125），无齿隙填 0';

  let s;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, error: `${label}需为有限数值` };
    s = String(raw);
  } else if (typeof raw === 'string') {
    s = raw.trim();
  } else {
    return { ok: false, error: `${label}格式不正确：${hint}` };
  }
  if (!s) return { ok: false, error: `${label}不能为空：${hint}` };

  let frac;
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length !== 2 || !/^[+-]?\d+$/.test(parts[0].trim()) || !/^\d+$/.test(parts[1].trim())) {
      return { ok: false, error: `${label}格式不正确：${hint}` };
    }
    const p = BigInt(parts[0].trim());
    const q = BigInt(parts[1].trim());
    if (q < 1n) return { ok: false, error: `${label}的分母需为正整数（当前 ${parts[1].trim()}）` };
    frac = makeFrac(p, q);
  } else {
    frac = parseDecimal(s);
    if (!frac) {
      return { ok: false, error: `${label}格式不正确：${hint}` };
    }
  }
  if (!allowNegative && frac.num < 0n) {
    return { ok: false, error: `${label}不能为负：${hint}` };
  }
  if (frac.den > MAX_FRAC_DEN) {
    return { ok: false, error: `${label}约分后的分母不能超过 10¹²` };
  }
  const absNum = frac.num < 0n ? -frac.num : frac.num;
  if (absNum > MAX_TURNS * frac.den) {
    return { ok: false, error: `${label}的绝对值不能超过 10¹² 转` };
  }
  return { ok: true, frac };
}

/**
 * 校验全部请求参数：级列表（齿数 + 齿隙宽度 + 初始间隙位置）与分段输入转数。
 * @param {*} body
 * @returns {{ok:true,stages:Array,segments:Array}|{ok:false,error:string}}
 */
function validateReciprocateInput(body) {
  const input = body && typeof body === 'object' ? body : {};

  // ---- 级列表：1～3 级，齿数 + 从动轴侧齿隙宽度 w + 初始间隙位置 g（0 ≤ g ≤ w） ----
  if (!Array.isArray(input.stages)) {
    return { ok: false, error: '级列表（stages）格式不正确' };
  }
  if (input.stages.length < MIN_STAGES || input.stages.length > MAX_STAGES) {
    return {
      ok: false,
      error: `级数需为 ${MIN_STAGES}～${MAX_STAGES} 级（当前 ${Array.isArray(input.stages) ? input.stages.length : 0} 级）`,
    };
  }
  const stages = [];
  for (let i = 0; i < input.stages.length; i++) {
    const row = input.stages[i];
    if (!row || typeof row !== 'object') {
      return { ok: false, error: `第 ${i + 1} 级数据格式不正确` };
    }
    const drive = parsePositiveInt(row.driveTeeth, `第 ${i + 1} 级主动齿数`, MAX_TEETH);
    if (!drive.ok) return { ok: false, error: drive.error };
    const driven = parsePositiveInt(row.drivenTeeth, `第 ${i + 1} 级从动齿数`, MAX_TEETH);
    if (!driven.ok) return { ok: false, error: driven.error };

    const width = parseFracValue(row.backlashWidth, `第 ${i + 1} 级从动轴侧齿隙宽度 w`, false);
    if (!width.ok) return { ok: false, error: width.error };
    const gap = parseFracValue(row.initialGap, `第 ${i + 1} 级初始间隙位置 g`, false);
    if (!gap.ok) return { ok: false, error: gap.error };
    // 0 ≤ g ≤ w（两者均非负，只需比较 g ≤ w）
    if (gap.frac.num * width.frac.den > width.frac.num * gap.frac.den) {
      return {
        ok: false,
        error: `第 ${i + 1} 级初始间隙位置 g 不能大于齿隙宽度 w（需满足 0 ≤ g ≤ w）`,
      };
    }
    stages.push({
      stage: i + 1,
      driveTeeth: drive.value,
      drivenTeeth: driven.value,
      backlashWidth: width.frac,
      initialGap: gap.frac,
    });
  }

  // ---- 分段：1～50 段有符号输入转数（允许 0，即停顿段） ----
  if (!Array.isArray(input.segments)) {
    return { ok: false, error: '分段列表（segments）格式不正确' };
  }
  if (input.segments.length < MIN_SEGMENTS || input.segments.length > MAX_SEGMENTS) {
    return {
      ok: false,
      error: `分段数需为 ${MIN_SEGMENTS}～${MAX_SEGMENTS} 段（当前 ${Array.isArray(input.segments) ? input.segments.length : 0} 段）`,
    };
  }
  const segments = [];
  for (let i = 0; i < input.segments.length; i++) {
    const turns = parseFracValue(input.segments[i], `第 ${i + 1} 段输入转数`, true);
    if (!turns.ok) return { ok: false, error: turns.error };
    segments.push(turns.frac);
  }

  return { ok: true, stages, segments };
}

/** 分数简短写法：分母为 1 时只写分子（用于结论文字） */
function fmt(f) {
  return f.den === 1n ? f.num.toString() : `${f.num}/${f.den}`;
}

/**
 * 主入口：逐段回放有符号输入转数在带齿隙齿轮链中的传递。
 *
 * @param {Array<{stage:number,driveTeeth:number,drivenTeeth:number,backlashWidth:object,initialGap:object}>} stages 已校验级列表
 * @param {Array<{num:bigint,den:bigint}>} segments 已校验分段输入转数（有符号分数）
 */
function replayReciprocate(stages, segments) {
  const stageCount = stages.length;
  const axisCount = stageCount + 1;

  // 各级负齿数比（从动轴位移 / 主动轴位移）：外啮合反向，r_k = −主动齿/从动齿
  const stageRatios = stages.map((st) =>
    makeFrac(-BigInt(st.driveTeeth), BigInt(st.drivenTeeth)),
  );

  // 状态：各级间隙游标 g_k（初始为录入值，跨段保留）；各轴累计位移（初始 0）
  const gaps = stages.map((st) => st.initialGap);
  const cumulative = Array.from({ length: axisCount }, () => ({ ...ZERO }));

  const segmentRows = segments.map((turns, si) => {
    // 输入轴：实际位移即本段输入转数
    cumulative[0] = addFrac(cumulative[0], turns);
    const axes = [{ axis: 1, actual: turns, cumulative: cumulative[0] }];
    const stageRows = [];

    let upstream = turns;
    for (let k = 0; k < stageCount; k++) {
      const ideal = mulFrac(upstream, stageRatios[k]); // d = 上游实际位移 × 负齿数比
      const shifted = addFrac(gaps[k], ideal); // u = g + d
      const gapAfter = clampFrac(shifted, ZERO, stages[k].backlashWidth); // g新 = min(w, max(0, u))
      const actual = subFrac(shifted, gapAfter); // 本级实际位移 = u − g新
      gaps[k] = gapAfter; // 更新游标（跨段保留）
      upstream = actual; // 本级实际位移传给下一级
      cumulative[k + 1] = addFrac(cumulative[k + 1], actual);
      axes.push({ axis: k + 2, actual, cumulative: cumulative[k + 1] });
      stageRows.push({ stage: k + 1, ideal, shifted, gapAfter, actual });
    }

    return { segment: si + 1, inputTurns: turns, axes, stages: stageRows };
  });

  const finalCumulative = cumulative.map((cum, i) => ({ axis: i + 1, cumulative: cum }));
  const finalGaps = gaps.map((gap, i) => ({ stage: i + 1, gap }));

  const gapText = finalGaps.map((g) => `第 ${g.stage} 级 ${fmt(g.gap)}`).join('、');
  const message =
    `共回放 ${segments.length} 段：输入轴累计位移 ${fmt(cumulative[0])} 转，` +
    `输出轴（轴 ${axisCount}）累计位移 ${fmt(cumulative[axisCount - 1])} 转；` +
    `末段后各级剩余间隙位置：${gapText} 转。`;

  return {
    stageCount,
    axisCount,
    segmentCount: segments.length,
    stages: stages.map((st, i) => ({
      stage: st.stage,
      driveTeeth: st.driveTeeth,
      drivenTeeth: st.drivenTeeth,
      stageRatio: stageRatios[i],
      backlashWidth: st.backlashWidth,
      initialGap: st.initialGap,
    })),
    segments: segmentRows,
    finalCumulative,
    finalGaps,
    message,
  };
}

module.exports = {
  MIN_STAGES,
  MAX_STAGES,
  MIN_SEGMENTS,
  MAX_SEGMENTS,
  MAX_FRAC_DEN,
  MAX_TURNS,
  validateReciprocateInput,
  replayReciprocate,
};
