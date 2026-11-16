const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + '/../src/lib/articleSearch.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObject })
const { searchTerms, matchesArticle } = exportsObject

test('pasted titles and DOI punctuation cannot introduce PostgREST filter syntax', () => {
  const terms = Array.from(searchTerms('游戏，(同伴)* %" \\ ＡＩ 10.1000/example'))
  assert.deepEqual(terms, ['游戏', '同伴', 'AI', '10', '1000', 'example'])
  assert.ok(terms.every(term => /^[\p{L}\p{N}\p{M}-]+$/u.test(term)))
})

test('case-insensitive AND matching works across title, abstract, source and DOI', () => {
  const article = { title_original: 'Play and learning', title_zh: '游戏与学习', abstract_original: null, abstract_zh: '同伴关系', source_name: 'Early Education', doi: '10.1000/example' }
  assert.equal(matchesArticle(article, 'PLAY education'), true)
  assert.equal(matchesArticle(article, '游戏 同伴'), true)
  assert.equal(matchesArticle(article, '10.1000/example'), true)
  assert.equal(matchesArticle(article, 'play missingword'), false)
})
