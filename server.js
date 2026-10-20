const express = require('express');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function loadConfig() {
  const defaults = {
    DEEPSEEK_API_KEY: '',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEEPSEEK_MODEL: 'deepseek-chat',
    PORT: 3008,
    PASSWORD: ''
  };
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    return Object.assign(defaults, cfg);
  } catch (e) {
    return defaults;
  }
}

const CONFIG = loadConfig();
const PORT = process.env.PORT || CONFIG.PORT || 3008;

const db = new DatabaseSync(path.join(__dirname, 'data.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    wxtitle TEXT,
    wx_pubtime TEXT,
    pmid TEXT,
    doi TEXT,
    journal TEXT,
    pubdate TEXT,
    accepted_date TEXT,
    title TEXT,
    title_cn TEXT,
    first_author TEXT,
    corresponding_authors TEXT,
    affiliations TEXT,
    journal_quartile TEXT,
    impact_factor TEXT,
    metrics_year TEXT,
    metrics_source TEXT,
    keywords TEXT,
    summary TEXT,
    conclusion TEXT,
    research_background TEXT,
    core_breakthrough TEXT,
    technical_innovation TEXT,
    key_results TEXT,
    applications TEXT,
    future_outlook TEXT,
    bioinformatics TEXT,
    methodological_insight TEXT,
    liver_search_query TEXT,
    liver_related_papers TEXT,
    liver_cancer_assessment TEXT,
    liver_cancer_design TEXT,
    liver_cancer_novelty TEXT,
    liver_checked_at TEXT,
    created_at TEXT
  )
`);
try { db.exec("ALTER TABLE items ADD COLUMN wx_pubtime TEXT"); } catch (e) {}
for (const col of [
  'title_cn', 'research_background', 'core_breakthrough', 'technical_innovation',
  'key_results', 'applications', 'future_outlook', 'bioinformatics',
  'first_author', 'corresponding_authors', 'affiliations', 'journal_quartile',
  'impact_factor', 'metrics_year', 'metrics_source'
  , 'accepted_date', 'methodological_insight', 'liver_search_query', 'liver_related_papers',
  'liver_cancer_assessment', 'liver_cancer_design', 'liver_cancer_novelty', 'liver_checked_at'
]) {
  try { db.exec(`ALTER TABLE items ADD COLUMN ${col} TEXT`); } catch (e) {}
}
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);
db.prepare("UPDATE jobs SET status = 'pending', error = '', updated_at = ? WHERE status = 'running'")
  .run(new Date().toISOString());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function getText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  });
  if (!res.ok) throw new Error('请求失败 HTTP ' + res.status);
  return await res.text();
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('请求失败 HTTP ' + res.status);
  return await res.json();
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t\u00a0]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

function getMeta(html, key) {
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + key + '["\'][^>]*>', 'i');
  const m = html.match(re);
  if (!m) return '';
  const c = m[0].match(/content=["\']([\s\S]*?)["\']/i);
  return c ? decodeEntities(c[1]) : '';
}

function extractWxTime(html) {
  let m = html.match(/var\s+ct\s*=\s*["']?(\d{10})/);
  if (!m) m = html.match(/["']?create_time["']?\s*[:=]\s*["']?(\d{10})/);
  if (m) {
    const d = new Date(Number(m[1]) * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return '';
}

function extractArticle(html) {
  let title = getMeta(html, 'og:title');
  if (!title) {
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (m) title = stripTags(m[1]);
  }
  if (!title) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (m) title = stripTags(m[1]);
  }

  let text = '';
  const idx = html.search(/id=["']js_content["']/i);
  if (idx >= 0) {
    let chunk = html.slice(idx);
    const end = chunk.search(/<script/i);
    if (end > 0) chunk = chunk.slice(0, end);
    text = stripTags(chunk);
  } else {
    text = stripTags(html);
  }
  return { title: title.trim(), text, pubtime: extractWxTime(html) };
}

function findIdentifiers(text) {
  const doiSet = new Set();
  const doiRe = /10\.\d{4,9}\/[^\s"'<>()\[\]]+/g;
  let m;
  while ((m = doiRe.exec(text)) !== null) {
    doiSet.add(m[0].replace(/[.,;:]+$/, ''));
  }
  const pmidSet = new Set();
  const pmidRe = /PMID[:\s]*([0-9]{6,9})/gi;
  while ((m = pmidRe.exec(text)) !== null) {
    pmidSet.add(m[1]);
  }
  return { dois: [...doiSet], pmids: [...pmidSet] };
}

async function pubsByDoi(doi) {
  const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=3&term=' +
    encodeURIComponent(doi + '[DOI]');
  const j = await getJson(url);
  return (j.esearchresult && j.esearchresult.idlist) || [];
}

async function pubsByTitleTerm(term) {
  const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=3&term=' +
    encodeURIComponent(term);
  const j = await getJson(url);
  return (j.esearchresult && j.esearchresult.idlist) || [];
}

async function fetchPubmed(id) {
  const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=' +
    encodeURIComponent(id) + '&rettype=abstract&retmode=xml';
  return await getText(url);
}

function xmlValue(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? stripTags(m[1]).trim() : '';
}

function parsePubmed(xml) {
  const title = xmlValue(xml, 'ArticleTitle').replace(/\.$/, '');
  const journal = xmlValue(xml, 'ISOAbbreviation') || xmlValue(xml, 'Title');
  const pmid = xmlValue(xml, 'PMID');
  const doiM = xml.match(/<ArticleId[^>]*IdType=["']doi["'][^>]*>([\s\S]*?)<\/ArticleId>/i);
  const year = xmlValue(xml, 'Year');
  const month = xmlValue(xml, 'Month');
  const day = xmlValue(xml, 'Day');
  const medlineDate = xmlValue(xml, 'MedlineDate');
  const abstracts = [...xml.matchAll(/<AbstractText(?:\s[^>]*)?>([\s\S]*?)<\/AbstractText>/gi)]
    .map(m => stripTags(m[1]).trim()).filter(Boolean);
  const authors = [...xml.matchAll(/<Author(?:\s[^>]*)?>([\s\S]*?)<\/Author>/gi)].map(m => {
    const block = m[1];
    const name = [xmlValue(block, 'ForeName'), xmlValue(block, 'LastName')].filter(Boolean).join(' ') ||
      xmlValue(block, 'CollectiveName');
    const affiliations = [...block.matchAll(/<Affiliation>([\s\S]*?)<\/Affiliation>/gi)]
      .map(x => stripTags(x[1]).trim()).filter(Boolean);
    return { name, affiliations };
  }).filter(a => a.name);
  const lastAuthor = authors[authors.length - 1] || { name: '', affiliations: [] };
  const affiliations = [...new Set(lastAuthor.affiliations)].slice(0, 8);
  const authorLine = authors.map(a => a.name).join(', ');
  const acceptedBlock = (xml.match(/<PubMedPubDate[^>]*PubStatus=["']accepted["'][^>]*>([\s\S]*?)<\/PubMedPubDate>/i) || [])[1] || '';
  const acceptedDate = acceptedBlock ? [xmlValue(acceptedBlock, 'Year'), xmlValue(acceptedBlock, 'Month'), xmlValue(acceptedBlock, 'Day')].filter(Boolean).join('-') : '';
  return {
    journal,
    doi: doiM ? stripTags(doiM[1]).trim() : '',
    pmid,
    pubdate: [year, month, day].filter(Boolean).join(' ') || medlineDate,
    accepted_date: acceptedDate,
    title,
    first_author: (authors[0] && authors[0].name) || '',
    corresponding_authors: lastAuthor.name || '',
    affiliations: affiliations.join('；'),
    abstract: abstracts.join('\n'),
    raw: [title, authorLine ? 'Authors: ' + authorLine : '', affiliations.length ? 'Affiliations: ' + affiliations.join('; ') : '', journal, abstracts.join('\n')].filter(Boolean).join('\n\n')
  };
}

function titleSimilarity(a, b) {
  const tokens = s => new Set(String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []);
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared++;
  return (2 * shared) / (x.size + y.size);
}

function parseJsonResponse(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(text); } catch (firstError) {
    const start = text.indexOf('{');
    if (start < 0) throw firstError;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
    throw firstError;
  }
}

async function deepseekJson(prompt) {
  const res = await fetch(CONFIG.DEEPSEEK_BASE_URL + '/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(90000),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CONFIG.DEEPSEEK_API_KEY
    },
    body: JSON.stringify({
      model: CONFIG.DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error('DeepSeek HTTP ' + res.status + (detail ? ': ' + detail : ''));
  }
  const j = await res.json();
  const content = (j.choices && j.choices[0] && j.choices[0].message.content) || '{}';
  return parseJsonResponse(content);
}

async function identifyPaper(text) {
  if (!CONFIG.DEEPSEEK_API_KEY) return null;
  const prompt = '判断下面这篇公众号文章主要介绍的是哪一篇科研论文。只输出 JSON，不要多余文字：' +
    '{"single":true或false,"title":"论文英文标题","doi":"DOI(文中明确写了才填,否则空)","pmid":"PMID(明确写了才填,否则空)",' +
    '"journal":"期刊英文名(文中提到才填,否则空)","year":"发表年份4位(文中提到才填,否则空)"}。' +
    '如果它只是行业综述/多个成果合集、没有单一主论文，则 single=false，title 填文章最主要的那个成果。\n\n文章：\n' +
    text.slice(0, 9000);
  try {
    const r = await deepseekJson(prompt);
    return {
      single: r.single !== false,
      title: (r.title || '').trim(),
      doi: (r.doi || '').trim().replace(/[.,;]+$/, ''),
      pmid: (r.pmid || '').trim(),
      journal: (r.journal || '').trim(),
      year: (r.year || '').trim().replace(/[^0-9]/g, '').slice(0, 4)
    };
  } catch (e) {
    return null;
  }
}

async function searchPmidByTitle(title, journal, year) {
  const tries = [];
  if (journal && year) tries.push(title + ' AND ' + journal + '[ta] AND ' + year + '[dp]');
  if (journal) tries.push(title + ' AND ' + journal + '[ta]');
  if (year) tries.push(title + ' AND ' + year + '[dp]');
  tries.push(title + '[Title]');
  tries.push(title);
  for (const term of tries) {
    try {
      const hits = await pubsByTitleTerm(term);
      for (const id of hits) {
        const candidate = parsePubmed(await fetchPubmed(id));
        if (titleSimilarity(title, candidate.title) >= 0.85) return id;
      }
    } catch (e) {}
  }
  return '';
}

async function searchCrossrefByTitle(title) {
  if (!title) return null;
  try {
    const url = 'https://api.crossref.org/works?rows=5&query.title=' + encodeURIComponent(title);
    const data = await getJson(url);
    const items = (data.message && data.message.items) || [];
    for (const item of items) {
      const candidateTitle = (item.title && item.title[0]) || '';
      if (titleSimilarity(title, candidateTitle) < 0.85) continue;
      const authors = (item.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
      const rawAuthors = item.author || [];
      const lastRawAuthor = rawAuthors[rawAuthors.length - 1] || {};
      const affiliations = [...new Set((lastRawAuthor.affiliation || []).map(x => x.name).filter(Boolean))].slice(0, 8);
      const dateParts = (item.published && item.published['date-parts'] && item.published['date-parts'][0]) ||
        (item.issued && item.issued['date-parts'] && item.issued['date-parts'][0]) || [];
      const abstract = item.abstract ? stripTags(item.abstract) : '';
      const journal = decodeEntities((item['container-title'] && item['container-title'][0]) || '');
      const acceptedParts = (item.accepted && item.accepted['date-parts'] && item.accepted['date-parts'][0]) || [];
      return {
        title: candidateTitle,
        doi: item.DOI || '',
        journal,
        pubdate: dateParts.join('-'),
        accepted_date: acceptedParts.join('-'),
        first_author: authors[0] || '',
        corresponding_authors: authors[authors.length - 1] || '',
        affiliations: affiliations.join('；'),
        raw: [candidateTitle, authors.length ? 'Authors: ' + authors.join(', ') : '', affiliations.length ? 'Affiliations: ' + affiliations.join('; ') : '', journal, abstract].filter(Boolean).join('\n\n')
      };
    }
  } catch (e) {}
  return null;
}

async function summarize(text) {
  if (!CONFIG.DEEPSEEK_API_KEY) {
    return { keywords: '', summary: '(未配置 DeepSeek API Key，仅抓取到原文)', conclusion: '' };
  }
  const prompt = '你是严谨的生命科学论文编辑。根据下面的公众号正文和论文摘要，生成适合个人文献库的中文解读。' +
    '只输出一个 JSON，不要 Markdown，不要多余文字。所有判断必须基于给定内容；信息不足时写“原文未说明”，不要编造。' +
    '{"title_cn":"论文英文标题的准确中文翻译","keywords":"5个中文关键词，用逗号分隔",' +
    '"first_author":"第一作者姓名；无法确认则空",' +
    '"corresponding_authors":"通讯作者姓名，多个用逗号分隔；仅在原文明确时填写，否则空",' +
    '"affiliations":"核心作者所属机构，最多列3个，用分号分隔；无法确认则空",' +
    '"pubdate":"论文发表日期(如 2024-12-12)，没有则空",' +
    '"summary":"不超过200字的中文总览，覆盖研究问题、方法和主要结论",' +
    '"conclusion":"一句话结论",' +
    '"research_background":"研究背景与未解决问题，120-220字",' +
    '"core_breakthrough":"相对既有研究最重要的突破，120-220字",' +
    '"technical_innovation":"实验设计、关键技术和分析方法的创新，使用2-4个短段或带序号短句，180-350字",' +
    '"key_results":"只保留3-5项最关键结果及必要数字，不逐图复述，250-450字",' +
    '"applications":"潜在科研或临床应用，120-220字",' +
    '"future_outlook":"研究局限、需要验证的问题与下一步方向，120-220字",' +
    '"bioinformatics":"从数据设计、分析流程、统计解释和可复用方法角度解读，180-350字；若生信内容有限则如实说明",' +
    '"methodological_insight":"像有经验的生信研究者一样，指出最值得借鉴的研究思维、方法组合、平台偏倚、统计陷阱和可复用创新；区分原文证据与编辑性推演，220-400字",' +
    '"liver_search_query":"为检索该研究思路是否已用于肝癌，给出简洁的英文 PubMed 方法关键词组合，不要包含 liver cancer 或 hepatocellular carcinoma"}。\n\n内容：\n' +
    text.slice(0, 22000);
  return await deepseekJson(prompt);
}

async function assessLiverCancerTransfer(paperTitle, methodInsight, searchQuery) {
  const cleanQuery = String(searchQuery || '').trim();
  if (!cleanQuery || !CONFIG.DEEPSEEK_API_KEY) {
    return { related: [], assessment: '', design: '', novelty: '' };
  }
  let ids = [];
  const methodPhrases = [
    'single-cell RNA sequencing', 'single-nucleus RNA sequencing', 'spatial transcriptomics',
    'RNA velocity', 'trajectory analysis', 'ligand-receptor', 'regulon', 'copy number variation',
    'multi-omics', 'metabolomics', 'proteomics'
  ].filter(x => cleanQuery.toLowerCase().includes(x.toLowerCase()));
  const queries = ['(' + cleanQuery + ') AND ("hepatocellular carcinoma" OR "liver cancer")'];
  if (methodPhrases.length) {
    queries.push('(' + methodPhrases.map(x => '"' + x + '"').join(' OR ') + ') AND ("hepatocellular carcinoma" OR "liver cancer")');
  }
  for (const term of queries) {
    try {
      const url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=6&sort=relevance&term=' + encodeURIComponent(term);
      const data = await getJson(url);
      ids.push(...((data.esearchresult && data.esearchresult.idlist) || []));
    } catch (e) {}
  }
  ids = [...new Set(ids)].slice(0, 6);

  const papers = [];
  for (const id of ids) {
    try {
      const p = parsePubmed(await fetchPubmed(id));
      papers.push({ pmid: id, title: p.title, journal: p.journal, pubdate: p.pubdate, abstract: p.abstract });
    } catch (e) {}
  }
  const evidence = papers.length ? papers.map((p, i) =>
    `${i + 1}. PMID ${p.pmid}\nTitle: ${p.title}\nJournal/date: ${p.journal} ${p.pubdate}\nAbstract: ${p.abstract}`
  ).join('\n\n') : '本次 PubMed 检索未返回直接相关记录。';
  const prompt = '你是肿瘤生信课题设计顾问。评估把一篇论文的研究思路迁移到肝细胞癌（HCC）的可行性。' +
    '只能依据给定的原论文方法学摘要和 PubMed 检索结果；未检索到不等于绝对没有研究，必须说明检索局限。' +
    '不要虚构文献、结果或 PMID。只输出 JSON：' +
    '{"assessment":"已有肝癌相关研究做到了什么、与原思路重合到什么程度，180-350字",' +
    '"design":"若用于肝癌，给出可执行的样本、平台、分析路线、验证和关键对照，250-450字",' +
    '"novelty":"判断仍可能存在的创新空间、最大撞题风险和开始课题前必须补查的内容，180-300字"}。\n\n' +
    '原论文标题：' + paperTitle + '\n\n方法学借鉴：' + methodInsight + '\n\nPubMed 证据：\n' + evidence.slice(0, 18000);
  const result = await deepseekJson(prompt);
  return {
    related: papers.map(({ pmid, title, journal, pubdate }) => ({ pmid, title, journal, pubdate })),
    assessment: result.assessment || '',
    design: result.design || '',
    novelty: result.novelty || ''
  };
}

async function processUrl(url) {
  const existingItem = db.prepare('SELECT title,pmid,doi,journal,pubdate,accepted_date,first_author,corresponding_authors,affiliations FROM items WHERE url = ?').get(url);
  const titleInput = url.startsWith('title:') ? decodeURIComponent(url.slice(6)) : '';
  let article = { title: '', text: '', pubtime: '' };
  let ids = { pmids: [], dois: [] };
  if (!titleInput) {
    const html = await getText(url);
    article = extractArticle(html);
    ids = findIdentifiers(article.text);
  }

  let pmid = titleInput ? await searchPmidByTitle(titleInput, '', '') : (ids.pmids[0] || '');
  let pubText = '';
  let mainTitle = titleInput;
  let identified = null;

  if (!pmid && !titleInput) {
    const idn = await identifyPaper(article.text);
    if (idn) {
      identified = idn;
      mainTitle = idn.title || '';
      if (idn.pmid) pmid = idn.pmid;
      if (!pmid && idn.doi) {
        try { const hits = await pubsByDoi(idn.doi); if (hits.length) pmid = hits[0]; } catch (e) {}
      }
      if (!pmid && idn.title) {
        pmid = await searchPmidByTitle(idn.title, idn.journal, idn.year);
      }
    }
  }
  if (!pmid) {
    for (const doi of ids.dois.slice(0, 5)) {
      try {
        const hits = await pubsByDoi(doi);
        if (hits.length) { pmid = hits[0]; break; }
      } catch (e) {}
    }
  }
  if (!pmid && (mainTitle || article.title)) {
    const t = mainTitle || article.title;
    pmid = await searchPmidByTitle(t.replace(/[【】\[\]|]/g, ' '), '', '');
  }
  const crossrefMeta = !pmid ? await searchCrossrefByTitle(mainTitle || titleInput) : null;
  if (titleInput && !pmid && !crossrefMeta) {
    throw new Error('PubMed 和 Crossref 均未找到与该标题足够匹配的论文，请检查英文标题或改用公众号链接');
  }

  let meta = {
    journal: (identified && identified.journal) || '',
    doi: ids.dois[0] || (identified && identified.doi) || '',
    pmid,
    pubdate: (identified && identified.year) || '',
    title: mainTitle || '',
    raw: ''
  };
  if (pmid) {
    pubText = await fetchPubmed(pmid);
    meta = parsePubmed(pubText);
    meta.pmid = pmid;
  } else if (crossrefMeta) {
    meta = { ...meta, ...crossrefMeta, pmid: '' };
  }
  if (existingItem && existingItem.title) {
    if (!meta.title || titleSimilarity(existingItem.title, meta.title) < 0.85) {
      meta = {
        ...meta,
        pmid: existingItem.pmid || '', doi: existingItem.doi || '', journal: existingItem.journal || '',
        pubdate: existingItem.pubdate || '', accepted_date: existingItem.accepted_date || '',
        first_author: existingItem.first_author || '', corresponding_authors: existingItem.corresponding_authors || '',
        affiliations: existingItem.affiliations || '', raw: ''
      };
    }
    meta.title = existingItem.title;
  }

  const sourceForLLM = (article.text ? ('【公众号内容】\n' + article.text + '\n\n') : '') +
    (meta.raw ? ('【PubMed 摘要】\n' + meta.raw) : '');
  const sum = await summarize(sourceForLLM);
  const finalTitle = meta.title || mainTitle || article.title || '';
  const liver = await assessLiverCancerTransfer(finalTitle, sum.methodological_insight || sum.bioinformatics || '', sum.liver_search_query || '');

  const rec = {
    url,
    wxtitle: article.title,
    wx_pubtime: article.pubtime || '',
    pmid: meta.pmid || '',
    doi: meta.doi || '',
    journal: meta.journal || '',
    pubdate: meta.pubdate || sum.pubdate || '',
    accepted_date: meta.accepted_date || '',
    title: finalTitle,
    title_cn: sum.title_cn || '',
    first_author: meta.first_author || sum.first_author || '',
    corresponding_authors: meta.corresponding_authors || sum.corresponding_authors || '',
    affiliations: meta.affiliations || sum.affiliations || '',
    keywords: sum.keywords || '',
    summary: sum.summary || '',
    conclusion: sum.conclusion || '',
    research_background: sum.research_background || '',
    core_breakthrough: sum.core_breakthrough || '',
    technical_innovation: sum.technical_innovation || '',
    key_results: sum.key_results || '',
    applications: sum.applications || '',
    future_outlook: sum.future_outlook || '',
    bioinformatics: sum.bioinformatics || '',
    methodological_insight: sum.methodological_insight || '',
    liver_search_query: sum.liver_search_query || '',
    liver_related_papers: JSON.stringify(liver.related || []),
    liver_cancer_assessment: liver.assessment || '',
    liver_cancer_design: liver.design || '',
    liver_cancer_novelty: liver.novelty || '',
    liver_checked_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  db.prepare(`INSERT INTO items
    (url,wxtitle,wx_pubtime,pmid,doi,journal,pubdate,accepted_date,title,title_cn,first_author,corresponding_authors,affiliations,keywords,summary,conclusion,
     research_background,core_breakthrough,technical_innovation,key_results,applications,future_outlook,bioinformatics,
     methodological_insight,liver_search_query,liver_related_papers,liver_cancer_assessment,liver_cancer_design,liver_cancer_novelty,liver_checked_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(url) DO UPDATE SET
      wxtitle=excluded.wxtitle, wx_pubtime=excluded.wx_pubtime, pmid=excluded.pmid,
      doi=excluded.doi, journal=excluded.journal, pubdate=excluded.pubdate, accepted_date=excluded.accepted_date,
      title=excluded.title, title_cn=excluded.title_cn, first_author=excluded.first_author,
      corresponding_authors=excluded.corresponding_authors, affiliations=excluded.affiliations,
      keywords=excluded.keywords,
      summary=excluded.summary, conclusion=excluded.conclusion,
      research_background=excluded.research_background, core_breakthrough=excluded.core_breakthrough,
      technical_innovation=excluded.technical_innovation, key_results=excluded.key_results,
      applications=excluded.applications, future_outlook=excluded.future_outlook,
      bioinformatics=excluded.bioinformatics, methodological_insight=excluded.methodological_insight,
      liver_search_query=excluded.liver_search_query, liver_related_papers=excluded.liver_related_papers,
      liver_cancer_assessment=excluded.liver_cancer_assessment, liver_cancer_design=excluded.liver_cancer_design,
      liver_cancer_novelty=excluded.liver_cancer_novelty, liver_checked_at=excluded.liver_checked_at,
      created_at=excluded.created_at`).run(
    rec.url, rec.wxtitle, rec.wx_pubtime, rec.pmid, rec.doi, rec.journal, rec.pubdate, rec.accepted_date,
    rec.title, rec.title_cn, rec.first_author, rec.corresponding_authors, rec.affiliations,
    rec.keywords, rec.summary, rec.conclusion,
    rec.research_background, rec.core_breakthrough, rec.technical_innovation,
    rec.key_results, rec.applications, rec.future_outlook, rec.bioinformatics,
    rec.methodological_insight, rec.liver_search_query, rec.liver_related_papers,
    rec.liver_cancer_assessment, rec.liver_cancer_design, rec.liver_cancer_novelty,
    rec.liver_checked_at, rec.created_at
  );
  return rec;
}

let running = false;

function normalizeSource(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.startsWith('title:')) return text;
  let u;
  try { u = new URL(text); } catch (e) {
    if (text.length < 8 || text.length > 600) return '';
    return 'title:' + encodeURIComponent(text);
  }
  if (u.protocol === 'https:' && u.hostname.toLowerCase() === 'mp.weixin.qq.com') {
    u.hash = '';
    return u.toString();
  }
  return '';
}

function enqueue(urls) {
  let queued = 0;
  let existing = 0;
  for (const raw of urls) {
    const url = normalizeSource(raw);
    if (!url) continue;
    if (db.prepare('SELECT 1 FROM items WHERE url = ?').get(url)) {
      existing++;
      continue;
    }
    const old = db.prepare('SELECT id, status FROM jobs WHERE url = ?').get(url);
    if (old) {
      if (old.status === 'error') {
        db.prepare("UPDATE jobs SET status = 'pending', error = '', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), old.id);
        queued++;
      } else {
        existing++;
      }
      continue;
    }
    const now = new Date().toISOString();
    db.prepare("INSERT INTO jobs (url,status,error,created_at,updated_at) VALUES (?,'pending','',?,?)")
      .run(url, now, now);
    queued++;
  }
  if (queued) pump();
  return { queued, existing };
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const job = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1").get();
      if (!job) break;
      db.prepare("UPDATE jobs SET status = 'running', error = '', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), job.id);
      try {
        await processUrl(job.url);
        db.prepare("UPDATE jobs SET status = 'done', error = '', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), job.id);
      } catch (e) {
        db.prepare("UPDATE jobs SET status = 'error', error = ?, updated_at = ? WHERE id = ?")
          .run(String((e && e.message) || e).slice(0, 1000), new Date().toISOString(), job.id);
      }
    }
  } finally {
    running = false;
  }
}

const app = express();
app.use(express.json());

function auth(req, res, next) {
  if (!CONFIG.PASSWORD) return next();
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    let dec = '';
    try { dec = Buffer.from(h.slice(6), 'base64').toString('utf8'); } catch (e) {}
    const i = dec.indexOf(':');
    const pass = i >= 0 ? dec.slice(i + 1) : dec;
    if (pass === CONFIG.PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="paper-bot"');
  return res.status(401).send('需要密码');
}
app.use(auth);

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/add', (req, res) => {
  const url = normalizeSource(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: '请提供微信公众号链接或完整论文标题' });
  res.json({ ok: true, ...enqueue([url]) });
});

app.post('/api/add-many', (req, res) => {
  const raw = Array.isArray(req.body && req.body.urls) ? req.body.urls : [];
  const valid = raw.map(normalizeSource).filter(Boolean);
  const list = [...new Set(valid)];
  if (!list.length) return res.status(400).json({ error: '没有检测到有效的微信公众号链接或论文标题' });
  res.json({ ok: true, ...enqueue(list), invalid: raw.length - valid.length, repeatedInput: valid.length - list.length });
});

app.get('/api/queue', (req, res) => {
  const counts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all().map(r => [r.status, Number(r.n)])
  );
  res.json({
    running,
    pending: counts.pending || 0,
    active: counts.running || 0,
    recent: db.prepare('SELECT id,url,status,error,updated_at FROM jobs ORDER BY id DESC LIMIT 30').all()
  });
});

app.post('/api/job/:id/retry', (req, res) => {
  const result = db.prepare("UPDATE jobs SET status = 'pending', error = '', updated_at = ? WHERE id = ? AND status = 'error'")
    .run(new Date().toISOString(), Number(req.params.id));
  if (!Number(result.changes)) return res.status(404).json({ error: '没有找到可重试的失败任务' });
  pump();
  res.json({ ok: true });
});

app.get('/api/list', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  let rows;
  if (q) {
    rows = db.prepare('SELECT * FROM items WHERE title LIKE ? OR title_cn LIKE ? OR wxtitle LIKE ? OR keywords LIKE ? OR journal LIKE ? OR first_author LIKE ? OR corresponding_authors LIKE ? OR affiliations LIKE ? ORDER BY id DESC')
      .all('%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%');
  } else {
    rows = db.prepare('SELECT * FROM items ORDER BY id DESC').all();
  }
  res.json(rows);
});

app.get('/api/item/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '记录不存在' });
  res.json(row);
});

app.delete('/api/item/:id', (req, res) => {
  const item = db.prepare('SELECT url FROM items WHERE id = ?').get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: '记录不存在' });
  db.prepare('DELETE FROM items WHERE id = ?').run(Number(req.params.id));
  db.prepare("DELETE FROM jobs WHERE url = ? AND status != 'running'").run(item.url);
  res.json({ ok: true });
});

app.post('/api/item/:id/reprocess', (req, res) => {
  const item = db.prepare('SELECT url FROM items WHERE id = ?').get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: '记录不存在' });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO jobs (url,status,error,created_at,updated_at)
    VALUES (?,'pending','',?,?)
    ON CONFLICT(url) DO UPDATE SET status='pending', error='', updated_at=excluded.updated_at`)
    .run(item.url, now, now);
  pump();
  res.json({ ok: true });
});

app.get('/api/export', (req, res) => {
  const rows = db.prepare('SELECT * FROM items ORDER BY id DESC').all();
  let md = '# 论文总结汇总\n\n共 ' + rows.length + ' 条\n\n';
  for (const r of rows) {
    md += '## ' + (r.title || r.wxtitle || '(无标题)') + '\n\n';
    if (r.title_cn) md += '**中文标题：** ' + r.title_cn + '\n\n';
    md += '- 时间：' + (r.accepted_date ? 'Accepted ' + r.accepted_date : (r.pubdate || '')) + '\n';
    if (r.wx_pubtime) md += '- 公众号发布：' + r.wx_pubtime + '\n';
    md += '- 期刊：' + (r.journal || '') + '\n';
    if (r.first_author) md += '- 第一作者：' + r.first_author + '\n';
    if (r.corresponding_authors) md += '- 通讯作者（按末位作者推定）：' + r.corresponding_authors + '\n';
    if (r.affiliations) md += '- 通讯作者所属机构：' + r.affiliations + '\n';
    md += '- PMID：' + (r.pmid || '') + '\n';
    md += '- DOI：' + (r.doi || '') + '\n';
    md += '- 关键词：' + (r.keywords || '') + '\n';
    md += '- 原文：' + r.url + '\n\n';
    md += (r.summary || '') + '\n\n';
    if (r.conclusion) md += '**结论：** ' + r.conclusion + '\n\n';
    const sections = [
      ['研究背景', r.research_background], ['核心突破', r.core_breakthrough],
      ['技术创新', r.technical_innovation], ['关键结果', r.key_results],
      ['应用前景', r.applications], ['未来展望', r.future_outlook],
      ['生信视角', r.bioinformatics], ['方法学借鉴与生信思考', r.methodological_insight],
      ['肝癌相关研究现状', r.liver_cancer_assessment], ['迁移到肝癌的研究设计', r.liver_cancer_design],
      ['创新空间与撞题风险', r.liver_cancer_novelty]
    ];
    for (const [heading, content] of sections) {
      if (content) md += '### ' + heading + '\n\n' + content + '\n\n';
    }
    try {
      const related = JSON.parse(r.liver_related_papers || '[]');
      if (related.length) {
        md += '### PubMed 检索依据\n\n';
        for (const p of related) md += '- PMID ' + p.pmid + '：' + p.title + '\n';
        md += '\n检索时间：' + (r.liver_checked_at || '') + '\n\n';
      }
    } catch (e) {}
    md += '---\n\n';
  }
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="papers.md"');
  res.send(md);
});

app.get('/api/backup', (req, res, next) => {
  try {
    const dir = path.join(__dirname, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = 'paper-bot-' + stamp + '.db';
    const file = path.join(dir, name);
    db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
    res.download(file, name);
  } catch (e) {
    next(e);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: String((err && err.message) || err) });
});

app.listen(PORT, () => {
  console.log('paper-bot 已启动: http://localhost:' + PORT);
  console.log('DeepSeek Key: ' + (CONFIG.DEEPSEEK_API_KEY ? '已配置' : '未配置') + ' | 访问密码: ' + (CONFIG.PASSWORD ? '已设置' : '未设置'));
});

setImmediate(pump);
