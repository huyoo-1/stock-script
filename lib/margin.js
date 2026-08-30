// 融资融券卡片数据格式化（含较前日变动）。抓取逻辑已迁至 lib/data/margin.js 的 fetcher。

// 构造卡片用的融资融券数据（含较前日变动）
function formatMargin(margin, prevMargin) {
  if (margin.error) return { error: margin.error };
  const prev = prevMargin && !prevMargin.error ? prevMargin : null;
  const finDelta = prev ? Math.round((margin.fin - prev.fin) * 100) / 100 : null;
  const loanDelta = prev ? Math.round((margin.loan - prev.loan) * 100) / 100 : null;
  const totalDelta = prev ? Math.round((margin.total - prev.total) * 100) / 100 : null;
  return {
    fin: margin.fin,
    loan: margin.loan,
    total: margin.total,
    finDelta,
    loanDelta,
    totalDelta,
    source: margin.source,
  };
}

module.exports = { formatMargin };
