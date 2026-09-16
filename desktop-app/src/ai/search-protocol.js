const MAX_CONTROL_LINE_LENGTH = 2048;
const MAX_QUERY_LENGTH = 300;

function invalidDecision() {
  throw new Error('模型搜尋決策格式無效。');
}

function hasDuplicateObjectKeys(line) {
  let index = 0;
  const keys = new Set();
  const skipWhitespace = () => {
    while (/\s/.test(line[index])) index++;
  };
  const readString = () => {
    if (line[index] !== '"') return null;
    const start = index++;
    while (index < line.length) {
      if (line[index] === '\\') { index += 2; continue; }
      if (line[index++] === '"') {
        try { return JSON.parse(line.slice(start, index)); }
        catch { return null; }
      }
    }
    return null;
  };
  const skipValue = () => {
    let depth = 0;
    while (index < line.length) {
      if (line[index] === '"') {
        if (readString() === null) return false;
        continue;
      }
      if (line[index] === '{' || line[index] === '[') depth++;
      else if (line[index] === '}' || line[index] === ']') {
        if (!depth) return line[index] === '}';
        depth--;
      } else if (line[index] === ',' && !depth) return true;
      index++;
    }
    return false;
  };

  skipWhitespace();
  if (line[index++] !== '{') return false;
  while (index < line.length) {
    skipWhitespace();
    if (line[index] === '}') return false;
    const key = readString();
    if (key === null) return false;
    if (keys.has(key)) return true;
    keys.add(key);
    skipWhitespace();
    if (line[index++] !== ':') return false;
    if (!skipValue()) return false;
    if (line[index] === '}') return false;
    index++;
  }
  return false;
}

function parseDecision(line) {
  if (typeof line !== 'string' || !line || line.length > MAX_CONTROL_LINE_LENGTH || /[\r\n]/.test(line)) invalidDecision();
  if (hasDuplicateObjectKeys(line)) invalidDecision();

  let value;
  try { value = JSON.parse(line); }
  catch { invalidDecision(); }

  if (!value || Array.isArray(value) || typeof value !== 'object') invalidDecision();
  const keys = Object.keys(value).sort();
  if (value.type === 'answer' && keys.length === 1 && keys[0] === 'type') return { type: 'answer' };
  if (value.type === 'search' && keys.length === 2 && keys[0] === 'query' && keys[1] === 'type'
    && typeof value.query === 'string' && value.query.trim() && value.query.length <= MAX_QUERY_LENGTH) {
    return { type: 'search', query: value.query };
  }
  invalidDecision();
}

function createSearchProtocol() {
  let state = 'control';
  let control = '';
  let decision;
  let searchTail = '';

  function failProtocol() {
    state = 'failed';
    invalidDecision();
  }

  function completeControl(line, text) {
    try { decision = parseDecision(line); }
    catch {
      state = 'failed';
      throw new Error('模型搜尋決策格式無效。');
    }
    state = decision.type;
    if (state === 'answer') return { decision, text };
    searchTail += text;
    return { text: '' };
  }

  function push(chunk) {
    if (state === 'finished' || state === 'failed' || typeof chunk !== 'string') failProtocol();
    if (state === 'answer') return { text: chunk };
    if (state === 'search') {
      searchTail += chunk;
      return { text: '' };
    }

    control += chunk;
    const newlineAt = control.indexOf('\n');
    if (newlineAt < 0) {
      if (control.length > MAX_CONTROL_LINE_LENGTH) failProtocol();
      return { text: '' };
    }
    const line = control.slice(0, newlineAt).replace(/\r$/, '');
    const text = control.slice(newlineAt + 1);
    control = '';
    return completeControl(line, text);
  }

  function finish() {
    if (state === 'finished' || state === 'failed') failProtocol();
    if (state === 'control') {
      if (!control) failProtocol();
      const result = completeControl(control, '');
      control = '';
      state = 'finished';
      return result;
    }
    state = 'finished';
    if (decision.type === 'search') {
      if (searchTail) failProtocol();
      return { decision, text: '' };
    }
    return { text: '' };
  }

  return { push, finish };
}

module.exports = { createSearchProtocol, parseDecision };
