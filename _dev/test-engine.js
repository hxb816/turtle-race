// 引擎自测：从 index.html 抽出 engine 段，跑大量随机对局检查不变量
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/\/\* ===ENGINE_START=== \*\/([\s\S]*?)\/\* ===ENGINE_END=== \*\//);
if (!m) { console.error('找不到 engine 段'); process.exit(1); }

const engine = new Function(
  m[1] + '\nreturn {Game, COLORS, TRACK, GOAL_COL, COLOR_META, makeDeck, aiDecideCard, cardName, TYPES};'
)();
const {Game, COLORS, TRACK, GOAL_COL, makeDeck, aiDecideCard} = engine;

let fails = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('  ✗ ' + msg); }
}

// --- 静态检查：牌组构成 ---
const deck = makeDeck();
ok(deck.length === 52, '牌组应为 52 张，实际 ' + deck.length);
const byKind = {};
deck.forEach(c => byKind[c.kind] = (byKind[c.kind] || 0) + 1);
ok(byKind.normal === 40, '普通牌 40 张，实际 ' + byKind.normal);
ok(byKind.rainbow === 7, '彩虹 7 张，实际 ' + byKind.rainbow);
ok(byKind.arrow === 3, '箭头 3 张，实际 ' + byKind.arrow);
ok(byKind.doublearrow === 2, '双箭头 2 张，实际 ' + byKind.doublearrow);
const rainbowPlus = deck.filter(c => c.kind === 'rainbow' && c.steps === 1).length;
const rainbowMinus = deck.filter(c => c.kind === 'rainbow' && c.steps === -1).length;
ok(rainbowPlus === 5 && rainbowMinus === 2, '彩虹 +1 五张 / -1 两张');

// --- 单元检查：移动语义 ---
(function unitMove() {
  const g = new Game({playerCount: 2, humanName: 'T'});
  // 起点后退无效
  const before = g.colOf('red');
  ok(g.move('red', -1) === null, '起点乌龟后退应无效');
  ok(g.colOf('red') === before, '起点乌龟不应移动');

  // 叠罗汉：把红龟推到 3，再把蓝龟推到 3（叠在红上），移动红龟应带走蓝龟
  g.move('red', 3);           // red -> 3
  g.move('blue', 3);          // blue -> 3, 叠在 red 上
  ok(g.stacks[3].length === 2, '第 3 格应有 2 只龟，实际 ' + g.stacks[3].length);
  ok(g.stacks[3][0] === 'red' && g.stacks[3][1] === 'blue', '红在下、蓝在上');
  const r = g.move('red', 1);
  ok(r && r.carried === 2, '移动红龟应带走蓝龟（carried=' + (r && r.carried) + '）');
  ok(g.stacks[4].indexOf('blue') >= 0, '蓝龟应跟着到第 4 格');
  ok(g.stacks[3].length === 0, '第 3 格应清空');

  // 冲过终点收敛到最后一格
  for (let i = 0; i < 20; i++) g.move('purple', 2);
  ok(g.colOf('purple') === GOAL_COL, '乌龟不应越过终点');
})();

// --- 随机对局跑量 ---
function invariants(g, tag) {
  const inHands = g.players.reduce((s, p) => s + p.hand.length, 0);
  ok(inHands + g.deck.length + g.discard.length === 52,
     tag + ' 牌数不守恒: ' + inHands + '+' + g.deck.length + '+' + g.discard.length);
  let seen = [];
  g.stacks.forEach(s => s.forEach(c => seen.push(c)));
  ok(seen.length === 5, tag + ' 场上应恒为 5 只龟，实际 ' + seen.length);
  COLORS.forEach(c => ok(seen.filter(x => x === c).length === 1, tag + ' 龟重复/丢失: ' + c));
  g.players.forEach(p => ok(p.hand.length <= 5, tag + ' 手牌超 5 张'));
}

let maxPlays = 0, totalPlays = 0, games = 0;
for (let pc = 2; pc <= 5; pc++) {
  for (let n = 0; n < 600; n++) {
    const g = new Game({playerCount: pc, humanName: 'T'});
    let guard = 0;
    while (!g.winner && guard < 5000) {
      guard++;
      const p = g.currentPlayer();
      const d = aiDecideCard(g, p);
      ok(d && d.handIndex >= 0 && d.handIndex < p.hand.length, 'AI 选牌索引非法');
      const res = g.play(g.turn, d.handIndex, d.color);
      ok(!res.error, '出牌失败: ' + JSON.stringify(res.error));
      invariants(g, 'pc=' + pc);
      if (g.winner) break;
      g.nextTurn();
      // 每 60 步检查一次即可，避免日志爆炸
      if (guard % 60 === 0) invariants(g, 'pc=' + pc);
    }
    ok(!!g.winner, 'pc=' + pc + ' 对局未能结束（超过 ' + guard + ' 步）');
    if (g.winner) {
      const goal = g.stacks[GOAL_COL];
      ok(goal.indexOf(g.winner.color) >= 0, '获胜者的龟必须在终点');
      ok(g.players.filter(x => x.color === g.winner.color).length === 1, '获胜者颜色唯一');
    }
    games++; totalPlays += g.plays; maxPlays = Math.max(maxPlays, g.plays);
  }
}

console.log('对局数: ' + games);
console.log('平均回合出牌数: ' + (totalPlays / games).toFixed(1));
console.log('最长一局出牌数: ' + maxPlays);
console.log(fails === 0 ? '✅ 全部检查通过' : '❌ 失败 ' + fails + ' 项');
process.exit(fails === 0 ? 0 : 1);
