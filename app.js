'use strict';
// Bungkus Rush - everything in one file. Run: node app.js
const GAME = (() => {
// Bungkus Rush - rules engine (server-authoritative).
// Card list follows the user's Nasi Lemak almanac (base game + Rendang Expansion).

const ING = ['rice', 'egg', 'peanuts', 'sambal', 'cucumber']; // the 5 base ingredients
// NOTE: the almanac's per-card counts add up to 34 actions even though its summary box says 25.
// We use the per-card counts so that every card shown exists. Edit here to change the mix.
const BASE_ACTIONS = { fly: 8, swatter: 7, fan: 5, supplier: 3, wholesaler: 3, thief: 3, officer: 3, makcik: 2 };
const EXP_ACTIONS = { supplier: 1, thief: 1, wholesaler: 1, fly: 1, officer: 1, makcik: 1, crow: 2, sioyen: 3 };
const EXP_RENDANG = 6;
const EXP_NASI = [1, 1, 2]; // values of the 3 extra Nasi Lemak cards (not specified in the almanac)
const CFG = { startHand: 5, draw: 2, actions: 2, handLimit: 7, win: 5, log: 40 };

const err = (error) => ({ ok: false, error });
const OK = { ok: true };

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createGame(playerList, rng = Math.random, opts = {}) {
  const expansion = !!opts.expansion;
  let seq = 0;
  const mk = (kind, type) => ({ id: 'c' + seq++, kind, type });
  const deck = [];
  for (const t of ING) for (let i = 0; i < 10; i++) deck.push(mk('ing', t));
  for (const [t, n] of Object.entries(BASE_ACTIONS)) for (let i = 0; i < n; i++) deck.push(mk('act', t));
  const nasiValues = [];
  for (let i = 0; i < 15; i++) nasiValues.push(i < 8 ? 1 : 2);
  if (expansion) {
    for (let i = 0; i < EXP_RENDANG; i++) deck.push(mk('ing', 'rendang'));
    for (const [t, n] of Object.entries(EXP_ACTIONS)) for (let i = 0; i < n; i++) deck.push(mk('act', t));
    nasiValues.push(...EXP_NASI);
  }
  const nasi = nasiValues.map((value, i) => ({ id: 'n' + i, value }));

  const g = {
    expansion,
    players: playerList.map((p) => ({ id: p.id, name: p.name, hand: [], packs: [], crow: null })),
    deck: shuffle(deck, rng),
    discard: [],
    nasi: shuffle(nasi, rng),
    nasiTotal: nasi.length,
    turn: 0,
    actionsLeft: 0,
    trade: null,
    pending: null, // officer: choose 2 cards from a revealed hand
    over: false,
    winners: [],
    log: [],
    packSeq: 0,
    rng,
  };
  g.cardTotal = g.deck.length;
  for (const p of g.players) drawCards(g, p, CFG.startHand);
  startTurn(g);
  return g;
}

function addLog(g, text) {
  g.log.push(text);
  if (g.log.length > CFG.log) g.log.shift();
}

function drawCards(g, p, n) {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const c = drawOne(g);
    if (!c) break;
    p.hand.push(c);
    drawn++;
  }
  return drawn;
}

function drawOne(g) {
  if (!g.deck.length) {
    g.deck = shuffle(g.discard, g.rng);
    g.discard = [];
  }
  return g.deck.length ? g.deck.pop() : null;
}

function startTurn(g) {
  const p = g.players[g.turn];
  g.actionsLeft = CFG.actions;
  drawCards(g, p, CFG.draw);
  addLog(g, `${p.name}'s turn.`);
}

function score(p) {
  return p.packs.reduce((s, k) => s + (k.fly ? 0 : k.value), 0);
}

const cur = (g) => g.players[g.turn];

function removeFromHand(p, ids) {
  const set = new Set(ids);
  const removed = p.hand.filter((c) => set.has(c.id));
  p.hand = p.hand.filter((c) => !set.has(c.id));
  return removed;
}

function pickCards(p, ids) {
  if (!Array.isArray(ids)) return null;
  if (new Set(ids).size !== ids.length) return null;
  const cards = [];
  for (const id of ids) {
    const c = p.hand.find((x) => x.id === id);
    if (!c) return null;
    cards.push(c);
  }
  return cards;
}

// n ingredient cards where every non-Rendang card is a different type (Rendang is a wildcard)
function validIngredientSet(cards, n) {
  if (!cards || cards.length !== n) return false;
  if (cards.some((c) => c.kind !== 'ing')) return false;
  const real = cards.filter((c) => c.type !== 'rendang');
  return new Set(real.map((c) => c.type)).size === real.length;
}

function finishAction(g, me) {
  if (score(me) >= CFG.win) {
    g.over = true;
    g.winners = [me.id];
    addLog(g, `${me.name} has ${score(me)} points and wins!`);
    return;
  }
  if (g.nasi.length === 0) {
    g.over = true;
    const best = Math.max(...g.players.map(score));
    g.winners = g.players.filter((p) => score(p) === best).map((p) => p.id);
    addLog(g, 'All Nasi Lemak cards are gone. Game over!');
    return;
  }
  g.actionsLeft--;
  if (g.actionsLeft <= 0 && me.hand.length <= CFG.handLimit) endTurnInternal(g);
}

function endTurnInternal(g) {
  g.turn = (g.turn + 1) % g.players.length;
  startTurn(g);
}

function makePack(g, me, how) {
  const card = g.nasi.pop();
  me.packs.push({ id: 'p' + g.packSeq++, value: card.value, fly: false });
  addLog(g, `${me.name} made a Nasi Lemak${how ? ' ' + how : ''}.`);
}

function apply(g, pid, a) {
  if (!a || typeof a !== 'object') return err('Bad action');
  if (g.over) return err('The game is over');
  const me = g.players.find((p) => p.id === pid);
  if (!me) return err('You are not in this game');

  // ----- trade responses (can come from the non-active player) -----
  if (a.type === 'tradeRespond') {
    if (!g.trade || g.trade.targetId !== pid) return err('No trade for you to answer');
    const t = g.trade;
    const from = g.players.find((p) => p.id === t.fromId);
    if (!a.accept) {
      g.trade = null;
      addLog(g, `${me.name} declined ${from.name}'s trade.`);
      return OK;
    }
    const give = [];
    const used = new Set();
    for (const type of t.want) {
      const c = me.hand.find((x) => x.kind === 'ing' && x.type === type && !used.has(x.id));
      if (!c) return err("You don't have the requested ingredients");
      used.add(c.id);
      give.push(c);
    }
    const offered = from.hand.filter((c) => t.offerIds.includes(c.id));
    if (offered.length !== t.offerIds.length) {
      g.trade = null;
      return err('The offer is no longer valid');
    }
    removeFromHand(me, give.map((c) => c.id));
    removeFromHand(from, offered.map((c) => c.id));
    me.hand.push(...offered);
    from.hand.push(...give);
    g.trade = null;
    addLog(g, `${from.name} and ${me.name} traded ${offered.length} for ${give.length}.`);
    finishAction(g, from);
    return OK;
  }
  if (a.type === 'tradeCancel') {
    if (!g.trade || g.trade.fromId !== pid) return err('No trade to cancel');
    g.trade = null;
    addLog(g, `${me.name} cancelled the trade.`);
    return OK;
  }

  // ----- Officer: take 2 cards from the revealed hand -----
  if (a.type === 'officerTake') {
    const pd = g.pending;
    if (!pd || pd.playerId !== pid) return err('Nothing to take');
    const target = g.players.find((p) => p.id === pd.targetId);
    const cards = pickCards(target, a.ids);
    if (!cards || cards.length !== pd.take) return err(`Take exactly ${pd.take} card${pd.take === 1 ? '' : 's'}`);
    removeFromHand(target, cards.map((c) => c.id));
    me.hand.push(...cards);
    g.pending = null;
    addLog(g, `${me.name} took ${cards.length} card${cards.length === 1 ? '' : 's'} from ${target.name}'s hand.`);
    finishAction(g, me);
    return OK;
  }

  // ----- everything else: active player only -----
  if (cur(g).id !== pid) return err('Not your turn');
  if (g.trade) return err('Finish the pending trade first');
  if (g.pending) return err('Finish the Officer action first');

  if (a.type === 'endTurn') {
    if (me.hand.length > CFG.handLimit) {
      const cards = pickCards(me, a.discardIds || []);
      if (!cards) return err('Invalid discard');
      if (me.hand.length - cards.length > CFG.handLimit) return err(`Discard down to ${CFG.handLimit} cards`);
      removeFromHand(me, cards.map((c) => c.id));
      g.discard.push(...cards);
    }
    endTurnInternal(g);
    return OK;
  }

  if (g.actionsLeft <= 0) return err('No actions left - end your turn');

  const useCard = (id, type) => {
    const c = me.hand.find((x) => x.id === id);
    return c && c.kind === 'act' && c.type === type ? c : null;
  };
  const discardCards = (cards) => {
    removeFromHand(me, cards.map((c) => c.id));
    g.discard.push(...cards);
  };
  const other = (id) => g.players.find((p) => p.id === id && p.id !== pid);
  const others = g.players.filter((p) => p.id !== pid);

  switch (a.type) {
    case 'make': {
      if (me.crow) return err('A Crow is blocking you - chase it away first');
      const cards = pickCards(me, a.ids);
      if (!validIngredientSet(cards, 5)) return err('You need 5 different ingredients (Rendang can stand in)');
      discardCards(cards);
      makePack(g, me, cards.some((c) => c.type === 'rendang') ? 'with Rendang' : '');
      finishAction(g, me);
      return OK;
    }
    case 'makcik': {
      if (me.crow) return err('A Crow is blocking you - chase it away first');
      const mc = useCard(a.cardId, 'makcik');
      if (!mc) return err('Card not in hand');
      const cards = pickCards(me, a.ids);
      if (!validIngredientSet(cards, 3)) return err('Pick 3 different ingredients (Rendang can stand in)');
      discardCards([mc, ...cards]);
      makePack(g, me, 'with Mak Cik');
      finishAction(g, me);
      return OK;
    }
    case 'fly': {
      const card = useCard(a.cardId, 'fly');
      if (!card) return err('Card not in hand');
      const t = other(a.targetId);
      const pack = t && t.packs.find((k) => k.id === a.packId);
      if (!pack) return err('Pick an opponent pack');
      if (pack.fly) return err('That pack already has a fly');
      discardCards([card]);
      pack.fly = true;
      addLog(g, `${me.name} put a fly on one of ${t.name}'s packs!`);
      finishAction(g, me);
      return OK;
    }
    case 'swatter': {
      const card = useCard(a.cardId, 'swatter');
      if (!card) return err('Card not in hand');
      const pack = me.packs.find((k) => k.id === a.packId);
      if (!pack || !pack.fly) return err('Pick one of your packs that has a fly');
      discardCards([card]);
      pack.fly = false;
      addLog(g, `${me.name} swatted a fly.`);
      finishAction(g, me);
      return OK;
    }
    case 'fan': {
      const card = useCard(a.cardId, 'fan');
      if (!card) return err('Card not in hand');
      const pack = me.packs.find((k) => k.id === a.packId);
      if (!pack || !pack.fly) return err('Pick one of your packs that has a fly');
      const t = other(a.targetId);
      const tp = t && t.packs.find((k) => k.id === a.targetPackId);
      if (!tp) return err("Pick another player's pack");
      if (tp.fly) return err('That pack already has a fly');
      discardCards([card]);
      pack.fly = false;
      tp.fly = true;
      addLog(g, `${me.name} fanned a fly over to ${t.name}!`);
      finishAction(g, me);
      return OK;
    }
    case 'supplier': {
      const card = useCard(a.cardId, 'supplier');
      if (!card) return err('Card not in hand');
      if (!ING.includes(a.ingredient)) return err('Pick one of the 5 ingredients');
      discardCards([card]);
      let got = 0;
      for (const p of others) {
        const take = p.hand.filter((c) => c.kind === 'ing' && c.type === a.ingredient);
        if (take.length) {
          removeFromHand(p, take.map((c) => c.id));
          me.hand.push(...take);
          got += take.length;
        }
      }
      addLog(g, `${me.name} called the Supplier for ${a.ingredient}: collected ${got}.`);
      finishAction(g, me);
      return OK;
    }
    case 'wholesaler': {
      const card = useCard(a.cardId, 'wholesaler');
      if (!card) return err('Card not in hand');
      discardCards([card]);
      const shown = [];
      for (let i = 0; i < 3; i++) {
        const c = drawOne(g);
        if (c) shown.push(c);
      }
      const keep = shown.filter((c) => c.kind === 'ing');
      const toss = shown.filter((c) => c.kind !== 'ing');
      me.hand.push(...keep);
      g.discard.push(...toss);
      addLog(g, `${me.name} used the Wholesaler: revealed ${shown.map((c) => c.type).join(', ') || 'nothing'} - kept ${keep.length}.`);
      finishAction(g, me);
      return OK;
    }
    case 'thief': {
      const card = useCard(a.cardId, 'thief');
      if (!card) return err('Card not in hand');
      if (!others.some((p) => p.hand.length)) return err('Nobody has cards to steal');
      discardCards([card]);
      let n = 0;
      for (const p of others) {
        if (!p.hand.length) continue;
        const i = Math.floor(g.rng() * p.hand.length);
        me.hand.push(p.hand.splice(i, 1)[0]);
        n++;
      }
      addLog(g, `${me.name} stole a card from ${n} player${n === 1 ? '' : 's'}!`);
      finishAction(g, me);
      return OK;
    }
    case 'officer': {
      const card = useCard(a.cardId, 'officer');
      if (!card) return err('Card not in hand');
      const t = other(a.targetId);
      if (!t) return err('Pick a player');
      if (!t.hand.length) return err(`${t.name} has no cards`);
      discardCards([card]);
      g.pending = { playerId: pid, targetId: t.id, take: Math.min(2, t.hand.length) };
      addLog(g, `${me.name} sent the Officer to inspect ${t.name}'s hand.`);
      return OK;
    }
    case 'crow': {
      const card = useCard(a.cardId, 'crow');
      if (!card) return err('Card not in hand');
      const t = other(a.targetId);
      if (!t) return err('Pick a player');
      if (!t.packs.length) return err(`${t.name} has not made any Nasi Lemak yet`);
      if (t.crow) return err(`${t.name} already has a Crow`);
      removeFromHand(me, [card.id]);
      card.pile = [];
      t.crow = card;
      addLog(g, `${me.name} sent a Crow to ${t.name}! They can't make Nasi Lemak until they chase it away.`);
      finishAction(g, me);
      return OK;
    }
    case 'chase': {
      if (!me.crow) return err('You have no Crow to chase');
      const t = other(a.targetId);
      if (!t) return err('Pick a player to chase it to');
      if (t.crow) return err(`${t.name} already has a Crow`);
      const pay = pickCards(me, [a.payId]);
      if (!pay || pay[0].kind !== 'ing') return err('Pay with 1 ingredient card');
      removeFromHand(me, [pay[0].id]);
      me.crow.pile.push(pay[0]);
      t.crow = me.crow;
      me.crow = null;
      addLog(g, `${me.name} paid an ingredient and chased the Crow over to ${t.name}!`);
      finishAction(g, me);
      return OK;
    }
    case 'sioyen': {
      const card = useCard(a.cardId, 'sioyen');
      if (!card) return err('Card not in hand');
      const t = g.players.find((p) => p.id === a.targetId);
      if (!t || !t.crow) return err('Pick a Crow to catch');
      discardCards([card]);
      const crow = t.crow;
      t.crow = null;
      me.hand.push(...crow.pile);
      const n = crow.pile.length;
      crow.pile = [];
      g.discard.push(crow);
      addLog(g, `${me.name}'s Si Oyen caught the Crow${t.id === pid ? '' : ' at ' + t.name + "'s stall"} and took ${n} ingredient${n === 1 ? '' : 's'}!`);
      finishAction(g, me);
      return OK;
    }
    case 'trade': {
      const t = other(a.targetId);
      if (!t) return err('Pick a player to trade with');
      const offer = pickCards(me, a.offerIds);
      if (!offer || !offer.length) return err('Pick cards to offer');
      const wantable = [...ING, 'rendang'];
      if (!Array.isArray(a.want) || !a.want.length || a.want.some((x) => !wantable.includes(x))) {
        return err('Pick the ingredients you want');
      }
      g.trade = { fromId: pid, targetId: t.id, offerIds: offer.map((c) => c.id), want: a.want.slice() };
      addLog(g, `${me.name} proposes a trade to ${t.name}.`);
      return OK;
    }
    default:
      return err('Unknown action');
  }
}

// What a given player is allowed to see.
function viewFor(g, pid) {
  const me = g.players.find((p) => p.id === pid);
  const reveal = g.over;
  const view = {
    expansion: g.expansion,
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      packs: p.packs.map((k) => ({
        id: k.id,
        fly: k.fly,
        value: p.id === pid || reveal ? k.value : null,
      })),
      score: p.id === pid || reveal ? score(p) : null,
      crow: p.crow ? { pileCount: p.crow.pile.length } : null,
    })),
    hand: me ? me.hand : [],
    turnId: cur(g).id,
    actionsLeft: g.actionsLeft,
    deckCount: g.deck.length,
    nasiLeft: g.nasi.length,
    handLimit: CFG.handLimit,
    win: CFG.win,
    over: g.over,
    winners: g.winners,
    log: g.log.slice(-12),
    trade: null,
    pending: null,
  };
  if (g.trade) {
    const from = g.players.find((p) => p.id === g.trade.fromId);
    const seeOffer = pid === g.trade.fromId || pid === g.trade.targetId;
    view.trade = {
      fromId: g.trade.fromId,
      targetId: g.trade.targetId,
      want: g.trade.want,
      offer: seeOffer ? from.hand.filter((c) => g.trade.offerIds.includes(c.id)) : null,
      offerCount: g.trade.offerIds.length,
    };
  }
  if (g.pending) {
    const target = g.players.find((p) => p.id === g.pending.targetId);
    view.pending = {
      playerId: g.pending.playerId,
      targetId: g.pending.targetId,
      take: g.pending.take,
      // only the officer's owner gets to see the hand
      hand: pid === g.pending.playerId ? target.hand : null,
    };
  }
  return view;
}

const exports_ = { createGame, apply, viewFor, score, ING, CFG, BASE_ACTIONS, EXP_ACTIONS };
return exports_;
})();
const HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no\">\n<meta name=\"theme-color\" content=\"#1f6b3a\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-title\" content=\"Bungkus Rush\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n<link rel=\"icon\" href=\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Ctext y=%27.9em%27 font-size=%2790%27%3E%F0%9F%8D%9B%3C/text%3E%3C/svg%3E\">\n<title>Bungkus Rush</title>\n<style>\n:root{--leaf:#1f6b3a;--leaf2:#2e8b4f;--cream:#fff7e6;--sambal:#c0392b;--ink:#2b2118;--mute:#7a6a58;--card:#fff;--line:#ead9b8;--gold:#e8a317}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;height:100%;background:var(--cream);color:var(--ink);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overscroll-behavior:none}\n#app{min-height:100%;display:flex;flex-direction:column;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}\nh1{margin:0;font-size:22px}\nheader{background:var(--leaf);color:#fff;padding:10px 14px;display:flex;align-items:center;justify-content:space-between}\nheader small{opacity:.85}\n.wrap{padding:14px;max-width:560px;width:100%;margin:0 auto}\n.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}\nlabel{display:block;font-size:13px;color:var(--mute);margin:8px 0 4px}\ninput{width:100%;font-size:17px;padding:11px 12px;border:1.5px solid var(--line);border-radius:10px;background:#fffdf8;color:var(--ink)}\nbutton{font:inherit;cursor:pointer}\n.btn{background:var(--leaf);color:#fff;border:0;border-radius:12px;padding:13px 16px;font-size:16px;font-weight:600;width:100%;margin-top:10px}\n.btn.alt{background:#fff;color:var(--leaf);border:2px solid var(--leaf)}\n.btn.red{background:var(--sambal)}\n.btn:disabled{opacity:.4}\n.row{display:flex;gap:8px}.row>*{flex:1}\n.code{font-size:44px;letter-spacing:8px;font-weight:800;text-align:center;color:var(--leaf)}\n.pl{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--line)}\n.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#bbb;margin-right:6px}.dot.on{background:#2ecc71}\n.opps{display:flex;gap:8px;overflow-x:auto;padding:10px 10px 4px}\n.opp{min-width:118px;background:#fff;border:2px solid var(--line);border-radius:12px;padding:8px}\n.opp.turn{border-color:var(--gold);box-shadow:0 0 0 2px #e8a31744}\n.opp b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.packs{min-height:26px;font-size:20px;margin-top:4px}\n.banner{margin:8px 10px;padding:10px 12px;border-radius:12px;background:#fff;border:2px solid var(--line);font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:8px}\n.banner.mine{background:#fff3d0;border-color:var(--gold)}\n.log{margin:0 10px;font-size:13px;color:var(--mute);line-height:1.4;max-height:78px;overflow:hidden}\n.mine-packs{margin:8px 10px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 10px;min-height:48px}\n.chip{display:inline-flex;align-items:center;gap:3px;background:#e9f6ee;border:1.5px solid var(--leaf2);border-radius:10px;padding:3px 8px;margin:3px 4px 3px 0;font-weight:700}\n.chip.fly{background:#fde8e5;border-color:var(--sambal)}\n.chip.back{background:#eee;border-color:#bbb;color:var(--mute)}\n.hand{display:flex;flex-wrap:wrap;gap:8px;padding:8px 10px;justify-content:center}\n.card{width:72px;min-height:96px;border-radius:12px;border:2px solid var(--line);background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px;font-size:30px;position:relative}\n.card small{font-size:10.5px;font-weight:700;color:var(--mute);line-height:1.1;text-align:center}\n.card.act{background:#fff4e0;border-color:#e0b46a}\n.card.sel{border-color:var(--leaf);box-shadow:0 0 0 3px #1f6b3a44;transform:translateY(-4px)}\n.bar{position:sticky;bottom:0;background:var(--cream);padding:8px 10px;border-top:1px solid var(--line);display:flex;gap:8px}\n.bar .btn{margin:0;padding:11px 8px;font-size:15px}\n.stats{display:flex;justify-content:space-between;padding:0 12px;font-size:12px;color:var(--mute)}\n#modal{position:fixed;inset:0;background:#0007;display:none;align-items:flex-end;justify-content:center;z-index:9}\n#modal.on{display:flex}\n.sheet{background:var(--cream);border-radius:18px 18px 0 0;padding:16px;width:100%;max-width:560px;max-height:80vh;overflow:auto}\n.sheet h3{margin:0 0 10px}\n.opt{display:block;width:100%;text-align:left;background:#fff;border:2px solid var(--line);border-radius:12px;padding:12px;margin-bottom:8px;font-size:16px;font-weight:600}\n.opt.on{border-color:var(--leaf);background:#e9f6ee}\n#toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 56px);transform:translateX(-50%);background:#2b2118;color:#fff;padding:10px 16px;border-radius:20px;font-size:14px;opacity:0;pointer-events:none;transition:opacity .2s;z-index:20;max-width:90%;text-align:center}\n#toast.on{opacity:1}\n.win{text-align:center;font-size:26px;font-weight:800}\n.reveal{font-size:14px;color:var(--mute)}\na{color:var(--leaf)}\n</style>\n</head>\n<body>\n<div id=\"app\"></div>\n<div id=\"modal\"><div class=\"sheet\" id=\"sheet\"></div></div>\n<div id=\"toast\"></div>\n<script>\n'use strict';\nconst META = {\n  rice:{e:'🍚',n:'Rice'}, egg:{e:'🥚',n:'Egg'}, peanuts:{e:'🥜',n:'Peanuts'}, sambal:{e:'🌶️',n:'Sambal'}, cucumber:{e:'🥒',n:'Cucumber'},\n  rendang:{e:'🍲',n:'Rendang',d:'Wildcard ingredient - stands in for any of the 5'},\n  fly:{e:'🪰',n:'Fly',d:\"Put on an opponent's pack - it stops scoring until removed\"},\n  swatter:{e:'🏏',n:'Fly Swatter',d:'Swat a fly off one of your packs'},\n  fan:{e:'💨',n:'Fan',d:\"Blow a fly off your pack onto another player's pack\"},\n  supplier:{e:'🚚',n:'Supplier',d:'Name an ingredient - every rival hands over ALL their copies'},\n  wholesaler:{e:'🛒',n:'Wholesaler',d:'Reveal the top 3 cards of the draw pile and keep the ingredients'},\n  thief:{e:'🦹',n:'Thief',d:'Steal 1 random card from every other player'},\n  officer:{e:'👮',n:'Officer',d:\"Look at a rival's whole hand and take 2 cards\"},\n  makcik:{e:'👵',n:'Mak Cik',d:'Make a pack with only 3 different ingredients'},\n  crow:{e:'🐦',n:'Crow',d:\"Place on a player who has made Nasi Lemak - they can't make more until they pay 1 ingredient to chase it to someone else\"},\n  sioyen:{e:'🐱',n:'Si Oyen',d:'Catch any Crow and take every ingredient under it'}\n};\nconst ING = ['rice','egg','peanuts','sambal','cucumber'];\nconst LS = {\n  get(k){try{return localStorage.getItem(k)}catch(e){return null}},\n  set(k,v){try{localStorage.setItem(k,v)}catch(e){}},\n  del(k){try{localStorage.removeItem(k)}catch(e){}}\n};\nconst server = location.origin;\nlet myName = LS.get('name') || '';\nlet session = null; try { session = JSON.parse(LS.get('session') || 'null'); } catch(e){}\nlet data = null, es = null, status = '';\nconst sel = new Set();\nconst $ = (s) => document.querySelector(s);\nconst esc = (s) => String(s).replace(/[&<>\"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\n\nfunction toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),2400)}\n\nasync function api(path, body){\n  if(!server) return {ok:false,error:'Set the server address first'};\n  try{\n    const r = await fetch(server+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});\n    return await r.json();\n  }catch(e){ return {ok:false,error:'Cannot reach the server'}; }\n}\n\nfunction connect(){\n  if(es){es.close();es=null}\n  if(!session) return;\n  status='Connecting...';\n  es = new EventSource(`${server}/api/events?code=${session.code}&pid=${session.pid}`);\n  es.onmessage = (e)=>{ status=''; data=JSON.parse(e.data); render(); };\n  es.onerror = ()=>{\n    if(es.readyState === 2){ leave(true); toast('Room not found - the server may have restarted'); }\n    else { status='Reconnecting...'; render(); }\n  };\n  render();\n}\nfunction leave(silent){\n  if(es){es.close();es=null}\n  session=null; data=null; sel.clear(); LS.del('session'); render();\n}\nfunction saveSession(r){ session={code:r.code,pid:r.pid}; LS.set('session',JSON.stringify(session)); connect(); }\n\nasync function act(a){\n  const r = await api('/api/action',{code:session.code,pid:session.pid,action:a});\n  if(!r.ok) toast(r.error||'Not allowed');\n  sel.clear();\n  return r;\n}\n\n// ---------- modal helpers ----------\nfunction openSheet(html){ $('#sheet').innerHTML=html; $('#modal').classList.add('on'); }\nfunction closeSheet(){ $('#modal').classList.remove('on'); $('#sheet').innerHTML=''; $('#sheet').dataset.trade=''; }\n$('#modal').addEventListener('click',(e)=>{ if(e.target.id==='modal'&&!$('#sheet').dataset.trade){ closeSheet(); if(closeSheet.cb){closeSheet.cb(null);closeSheet.cb=null} } });\nfunction choose(title, options){\n  return new Promise((resolve)=>{\n    closeSheet.cb = resolve;\n    openSheet(`<h3>${esc(title)}</h3>`+options.map((o,i)=>`<button class=\"opt\" data-i=\"${i}\">${esc(o.label)}</button>`).join('')+`<button class=\"btn alt\" data-i=\"-1\">Cancel</button>`);\n    $('#sheet').onclick = (e)=>{\n      const b=e.target.closest('[data-i]'); if(!b) return;\n      const i=+b.dataset.i; closeSheet.cb=null; closeSheet(); resolve(i>=0?options[i].value:null);\n    };\n  });\n}\n\n// ---------- screens ----------\nfunction render(){\n  const app=$('#app');\n  if(!session){ app.innerHTML=lobbyHtml(); bindLobby(); return; }\n  if(!data){ app.innerHTML=header()+`<div class=\"wrap\"><div class=\"panel\">${esc(status||'Connecting...')}</div><button class=\"btn alt\" id=\"leave\">Back</button></div>`; $('#leave').onclick=()=>leave(); return; }\n  if(!data.game){ app.innerHTML=roomHtml(); bindRoom(); return; }\n  app.innerHTML=gameHtml(); bindGame();\n}\nfunction header(extra){ return `<header><h1>🍛 Bungkus Rush</h1><small>${extra||''}${status?' · '+esc(status):''}</small></header>`; }\n\nfunction lobbyHtml(){\n  return header()+`<div class=\"wrap\">\n  <div class=\"panel\">\n    <label>Your name</label><input id=\"name\" maxlength=\"14\" value=\"${esc(myName)}\" placeholder=\"e.g. Nikhil\">\n    <button class=\"btn\" id=\"create\">Create a room</button>\n  </div>\n  <div class=\"panel\">\n    <label>Join a friend's room</label><input id=\"code\" maxlength=\"4\" placeholder=\"ROOM CODE\" style=\"text-transform:uppercase;letter-spacing:6px;text-align:center\">\n    <button class=\"btn alt\" id=\"join\">Join room</button>\n  </div>\n  </div>`;\n}\nfunction bindLobby(){\n  const readServer=()=>{ myName=$('#name').value.trim(); LS.set('name',myName); };\n  $('#create').onclick=async()=>{ readServer(); if(!myName) return toast('Enter your name'); const r=await api('/api/create',{name:myName}); r.ok?saveSession(r):toast(r.error); };\n  $('#join').onclick=async()=>{ readServer(); if(!myName) return toast('Enter your name'); const code=$('#code').value.trim().toUpperCase(); if(code.length!==4) return toast('Enter the 4-letter code'); const r=await api('/api/join',{name:myName,code}); r.ok?saveSession(r):toast(r.error); };\n}\n\nfunction roomHtml(){\n  const r=data.room, host=r.hostId===data.you;\n  return header('Room')+`<div class=\"wrap\">\n  <div class=\"panel\"><div class=\"reveal\" style=\"text-align:center\">Room code - tell your friends</div><div class=\"code\">${esc(r.code)}</div></div>\n  <div class=\"panel\"><b>Players (${r.players.length}/${r.maxPlayers})</b>${r.players.map(p=>`<div class=\"pl\"><span><span class=\"dot ${p.connected?'on':''}\"></span>${esc(p.name)}${p.id===data.you?' (you)':''}</span><span>${p.id===r.hostId?'👑 host':''}</span></div>`).join('')}</div>\n  <div class=\"panel\"><b>🍲 Rendang Expansion: ${r.expansion?'ON':'OFF'}</b><div class=\"reveal\">${r.expansion?'Adds Rendang wildcards, Crows, Si Oyen, extra action cards and Nasi Lemak cards. Up to 7 players.':'Base game only. Up to 5 players.'}</div>\n  ${host?`<button class=\"btn alt\" id=\"exp\">Turn expansion ${r.expansion?'OFF':'ON'}</button>`:''}</div>\n  ${host?`<button class=\"btn\" id=\"start\" ${r.players.length<2?'disabled':''}>Start game</button>`:`<div class=\"panel\" style=\"text-align:center\">Waiting for the host to start...</div>`}\n  <button class=\"btn alt\" id=\"leave\">Leave room</button>\n  <div class=\"panel\" style=\"margin-top:12px\"><b>How to win</b><div class=\"reveal\">Collect one each of 🍚 🥚 🥜 🌶️ 🥒 to make a Nasi Lemak pack (worth 1 or 2 secret points). First to 5 points wins. Each turn you draw 2 cards and get 2 actions: make a pack, play an action card, or trade. 🪰 A fly stops a pack from scoring until it's swatted or fanned away. Tap any card to read what it does. Hand limit is 7.</div></div></div>`;\n}\nfunction bindRoom(){\n  $('#leave').onclick=()=>leave();\n  const s=$('#start'); if(s) s.onclick=async()=>{ const r=await api('/api/start',{code:session.code,pid:session.pid}); if(!r.ok) toast(r.error); };\n  const x=$('#exp'); if(x) x.onclick=async()=>{ const r=await api('/api/options',{code:session.code,pid:session.pid,expansion:!data.room.expansion}); if(!r.ok) toast(r.error); };\n}\n\nfunction cardHtml(c){\n  const m=META[c.type]; const cls=['card',c.kind==='act'?'act':'',sel.has(c.id)?'sel':''].join(' ');\n  return `<button class=\"${cls}\" data-id=\"${c.id}\"><span>${m.e}</span><small>${m.n}</small></button>`;\n}\nfunction crowChip(p){ return p.crow?`<span class=\"chip fly\">🐦${p.crow.pileCount?' +'+p.crow.pileCount:''}</span>`:''; }\nfunction packChips(p, mine){\n  if(!p.packs.length) return '<span class=\"reveal\">no packs yet</span>';\n  return p.packs.map((k,i)=>`<span class=\"chip ${k.fly?'fly':''} ${mine?'':'back'}\">📦${mine||k.value!=null?k.value:'?'}${k.fly?'🪰':''}</span>`).join('');\n}\n\nfunction gameHtml(){\n  const g=data.game, me=g.players.find(p=>p.id===data.you), myTurn=g.turnId===data.you;\n  for(const id of [...sel]) if(!g.hand.some(c=>c.id===id)) sel.delete(id);\n  const turnP=g.players.find(p=>p.id===g.turnId);\n  const opps=g.players.filter(p=>p.id!==data.you);\n  const hand=g.hand.slice().sort((a,b)=>(a.kind===b.kind?a.type.localeCompare(b.type):a.kind==='ing'?-1:1));\n  let top='';\n  if(g.over){\n    const names=g.winners.map(id=>g.players.find(p=>p.id===id).name).join(' & ');\n    top=`<div class=\"panel win\" style=\"margin:10px\">🏆 ${esc(names)} won!<div class=\"reveal\" style=\"font-weight:400;margin-top:6px\">${g.players.map(p=>`${esc(p.name)}: ${p.score} pts`).join(' · ')}</div>\n    ${data.room.hostId===data.you?'<button class=\"btn\" id=\"again\">Back to lobby (play again)</button>':'<div class=\"reveal\">Waiting for the host to restart...</div>'}\n    <button class=\"btn alt\" id=\"leave\">Leave</button></div>`;\n  } else {\n    const banner = myTurn\n      ? `<div class=\"banner mine\"><span>Your turn · ${g.actionsLeft} action${g.actionsLeft===1?'':'s'} left</span></div>`\n      : `<div class=\"banner\"><span>${esc(turnP.name)}'s turn</span><span>${g.actionsLeft} left</span></div>`;\n    top=banner;\n  }\n  return header(`Room ${esc(data.room.code)}`)+\n  `<div class=\"opps\">${opps.map(p=>`<div class=\"opp ${p.id===g.turnId?'turn':''}\"><b>${esc(p.name)}</b><span class=\"reveal\">🃏 ${p.handCount}</span><div class=\"packs\">${packChips(p,false)}${crowChip(p)}</div></div>`).join('')}</div>`+\n  top+\n  ((!g.over&&me.crow)?`<div class=\"banner\" style=\"background:#fde8e5;border-color:var(--sambal)\"><span>🐦 A Crow is blocking your stall (${me.crow.pileCount} under it)</span><button class=\"btn red\" id=\"chase\" style=\"width:auto;margin:0;padding:8px 14px\" ${myTurn&&g.actionsLeft>0&&!g.trade&&!g.pending?'':'disabled'}>Chase</button></div>`:'')+\n  `<div class=\"log\">${g.log.slice(-4).map(l=>`<div>${esc(l)}</div>`).join('')}</div>`+\n  `<div class=\"mine-packs\"><b>Your packs</b> <span class=\"reveal\">(${me.score} pts / ${g.win} to win)</span><div>${packChips(me,true)}${crowChip(me)}</div></div>`+\n  `<div class=\"stats\"><span>Draw pile: ${g.deckCount}</span><span>Nasi Lemak cards left: ${g.nasiLeft}</span></div>`+\n  `<div class=\"hand\">${hand.map(cardHtml).join('')}</div>`+\n  `<div style=\"flex:1\"></div>`+\n  (g.over?'':`<div class=\"bar\"><button class=\"btn\" id=\"make\" ${myTurn&&g.actionsLeft>0&&!g.trade&&!g.pending?'':'disabled'}>🍛 Make</button><button class=\"btn alt\" id=\"trade\" ${myTurn&&g.actionsLeft>0&&!g.trade&&!g.pending?'':'disabled'}>🔁 Trade</button><button class=\"btn red\" id=\"end\" ${myTurn&&!g.trade&&!g.pending?'':'disabled'}>End turn</button></div>`);\n}\n\nfunction bindGame(){\n  const g=data.game, myTurn=g.turnId===data.you;\n  const again=$('#again'); if(again) again.onclick=async()=>{ const r=await api('/api/lobby',{code:session.code,pid:session.pid}); if(!r.ok) toast(r.error); };\n  const lv=$('#leave'); if(lv) lv.onclick=()=>leave();\n  document.querySelectorAll('.hand .card').forEach(el=>{\n    let timer=null;\n    el.onclick=()=>handleCard(el.dataset.id);\n    el.oncontextmenu=(e)=>{e.preventDefault();showInfo(el.dataset.id)};\n  });\n  const mk=$('#make'); if(mk) mk.onclick=makeNasi;\n  const tr=$('#trade'); if(tr) tr.onclick=startTrade;\n  const en=$('#end'); if(en) en.onclick=endTurn;\n  const ch=$('#chase'); if(ch) ch.onclick=chaseCrow;\n  syncTradeSheet();\n}\n\nfunction cardById(id){ return data.game.hand.find(c=>c.id===id); }\nfunction showInfo(id){ const c=cardById(id); if(!c) return; toast(META[c.type].n+(META[c.type].d?': '+META[c.type].d:'')); }\n\nasync function handleCard(id){\n  const g=data.game, c=cardById(id); if(!c) return;\n  if(c.kind==='ing'){ sel.has(id)?sel.delete(id):sel.add(id); render(); return; }\n  if(g.turnId!==data.you) return toast('Not your turn');\n  if(g.actionsLeft<=0) return toast('No actions left');\n  if(g.trade) return toast('Finish the trade first');\n  const m=META[c.type];\n  const ok=await choose(`${m.e} ${m.n}`,[{label:'Play it — '+m.d,value:true}]);\n  if(ok) playAction(c);\n}\n\nasync function playAction(c){\n  const g=data.game, me=g.players.find(p=>p.id===data.you);\n  const opps=g.players.filter(p=>p.id!==me.id);\n  const flyMine=me.packs.filter(k=>k.fly);\n  const packLabel=(p,k)=>`${p.name} · pack ${p.packs.indexOf(k)+1}`;\n  switch(c.type){\n    case 'fly':{\n      const o=[]; for(const p of opps) for(const k of p.packs) if(!k.fly) o.push({label:packLabel(p,k),value:{targetId:p.id,packId:k.id}});\n      if(!o.length) return toast('Nobody has a pack without a fly yet');\n      const v=await choose('Put the fly on…',o); if(v) act({type:'fly',cardId:c.id,...v}); break; }\n    case 'swatter':{\n      if(!flyMine.length) return toast('None of your packs has a fly');\n      const v=flyMine.length===1?flyMine[0].id:await choose('Swat the fly on…',flyMine.map(k=>({label:'Your pack '+(me.packs.indexOf(k)+1)+' (worth '+k.value+')',value:k.id})));\n      if(v) act({type:'swatter',cardId:c.id,packId:v}); break; }\n    case 'fan':{\n      if(!flyMine.length) return toast('None of your packs has a fly');\n      const mine=flyMine.length===1?flyMine[0].id:await choose('Fan the fly off…',flyMine.map(k=>({label:'Your pack '+(me.packs.indexOf(k)+1),value:k.id})));\n      if(!mine) return;\n      const o=[]; for(const p of opps) for(const k of p.packs) if(!k.fly) o.push({label:packLabel(p,k),value:{targetId:p.id,targetPackId:k.id}});\n      if(!o.length) return toast('No pack to blow it onto');\n      const v=await choose('…and onto',o); if(v) act({type:'fan',cardId:c.id,packId:mine,...v}); break; }\n    case 'supplier':{\n      const v=await choose('Every rival hands over all their…',ING.map(t=>({label:META[t].e+' '+META[t].n,value:t}))); if(v) act({type:'supplier',cardId:c.id,ingredient:v}); break; }\n    case 'wholesaler': act({type:'wholesaler',cardId:c.id}); break;\n    case 'thief':\n      if(!opps.some(p=>p.handCount>0)) return toast('Nobody has cards to steal');\n      act({type:'thief',cardId:c.id}); break;\n    case 'officer':{\n      const o=opps.filter(p=>p.handCount>0).map(p=>({label:`${p.name} (${p.handCount} cards)`,value:p.id}));\n      if(!o.length) return toast('Nobody has cards');\n      const v=await choose('Inspect the hand of…',o); if(v) act({type:'officer',cardId:c.id,targetId:v}); break; }\n    case 'crow':{\n      const o=opps.filter(p=>p.packs.length&&!p.crow).map(p=>({label:`${p.name} (${p.packs.length} pack${p.packs.length>1?'s':''})`,value:p.id}));\n      if(!o.length) return toast('Nobody who has made Nasi Lemak is free of a Crow');\n      const v=await choose('Send the Crow to…',o); if(v) act({type:'crow',cardId:c.id,targetId:v}); break; }\n    case 'sioyen':{\n      const o=g.players.filter(p=>p.crow).map(p=>({label:`${p.id===me.id?'Your':p.name+\"'s\"} Crow (${p.crow.pileCount} ingredient${p.crow.pileCount===1?'':'s'} under it)`,value:p.id}));\n      if(!o.length) return toast('There is no Crow to catch');\n      const v=await choose('Si Oyen pounces on…',o); if(v) act({type:'sioyen',cardId:c.id,targetId:v}); break; }\n    case 'makcik':{\n      const ids=autoPick(3);\n      if(!ids) return toast('You need 3 different ingredients (Rendang can stand in)');\n      act({type:'makcik',cardId:c.id,ids}); break; }\n  }\n}\n\nfunction isValidSet(cs,n){ if(cs.length!==n||cs.some(c=>c.kind!=='ing')) return false; const real=cs.filter(c=>c.type!=='rendang'); return new Set(real.map(c=>c.type)).size===real.length; }\n// Use the cards you've tapped if they form a valid set, otherwise pick automatically (real ingredients first, Rendang fills gaps).\nfunction autoPick(n){\n  const g=data.game, chosen=[...sel].map(cardById).filter(Boolean);\n  if(isValidSet(chosen,n)) return chosen.map(c=>c.id);\n  const hand=g.hand.filter(c=>c.kind==='ing'), seen=new Set(), ids=[];\n  for(const c of hand) if(c.type!=='rendang'&&!seen.has(c.type)&&ids.length<n){seen.add(c.type);ids.push(c.id)}\n  for(const c of hand) if(c.type==='rendang'&&ids.length<n) ids.push(c.id);\n  return ids.length===n?ids:null;\n}\n\nfunction makeNasi(){\n  const ids=autoPick(5);\n  if(!ids) return toast('You need one of each: 🍚 🥚 🥜 🌶️ 🥒 (Rendang can stand in, or play Mak Cik for 3)');\n  act({type:'make',ids});\n}\n\nasync function chaseCrow(){\n  const g=data.game;\n  const ings=g.hand.filter(c=>c.kind==='ing');\n  if(!ings.length) return toast('You need an ingredient to pay');\n  const targets=g.players.filter(p=>p.id!==data.you&&!p.crow).map(p=>({label:p.name,value:p.id}));\n  if(!targets.length) return toast('Everyone else already has a Crow');\n  const selIng=[...sel].map(cardById).filter(c=>c&&c.kind==='ing');\n  const pay=selIng.length===1?selIng[0].id:await choose('Pay which ingredient?',ings.map(c=>({label:META[c.type].e+' '+META[c.type].n,value:c.id})));\n  if(!pay) return;\n  const t=await choose('Chase the Crow over to…',targets); if(t) act({type:'chase',payId:pay,targetId:t});\n}\n\nasync function startTrade(){\n  const g=data.game;\n  const offer=[...sel]; if(!offer.length) return toast('Tap the cards you want to give first');\n  const opps=g.players.filter(p=>p.id!==data.you).map(p=>({label:`${p.name} (${p.handCount} cards)`,value:p.id}));\n  const target=await choose('Trade with…',opps); if(!target) return;\n  const want=[];\n  for(;;){\n    const t=await choose(`You want${want.length?': '+want.map(x=>META[x].e).join(' '):''}`,[...[...ING,...(g.expansion?['rendang']:[])].map(t=>({label:'Add '+META[t].e+' '+META[t].n,value:t})),...(want.length?[{label:'✅ Send offer',value:'done'}]:[])]);\n    if(!t) return; if(t==='done') break; want.push(t);\n  }\n  const r=await act({type:'trade',targetId:target,offerIds:offer,want});\n  if(r.ok) toast('Offer sent');\n}\n\nasync function endTurn(){\n  const g=data.game, over=g.hand.length-g.handLimit;\n  let discardIds=[];\n  if(over>0){\n    const picked=await new Promise((resolve)=>{\n      const chosen=new Set();\n      closeSheet.cb=resolve;\n      const draw=()=>{\n        openSheet(`<h3>Discard ${over} card${over>1?'s':''} (hand limit ${g.handLimit})</h3><div class=\"hand\">${g.hand.map(c=>`<button class=\"card ${c.kind==='act'?'act':''} ${chosen.has(c.id)?'sel':''}\" data-id=\"${c.id}\"><span>${META[c.type].e}</span><small>${META[c.type].n}</small></button>`).join('')}</div><button class=\"btn\" id=\"dc\" ${chosen.size===over?'':'disabled'}>Discard & end turn</button><button class=\"btn alt\" id=\"dx\">Cancel</button>`);\n        $('#sheet').onclick=(e)=>{\n          const c=e.target.closest('.card'); if(c){ const id=c.dataset.id; chosen.has(id)?chosen.delete(id):(chosen.size<over&&chosen.add(id)); draw(); return; }\n          if(e.target.id==='dc'){ closeSheet.cb=null; closeSheet(); resolve([...chosen]); }\n          if(e.target.id==='dx'){ closeSheet.cb=null; closeSheet(); resolve(null); }\n        };\n      };\n      draw();\n    });\n    if(!picked) return; discardIds=picked;\n  }\n  act({type:'endTurn',discardIds});\n}\n\n// Trade / Officer prompts, kept in sync with server state.\nlet tradeKey='';\nfunction syncTradeSheet(){\n  const g=data.game, t=g.trade, pd=g.pending;\n  const iAmOfficer=pd&&pd.playerId===data.you&&pd.hand;\n  const key=t?`t|${t.fromId}|${t.targetId}|${(t.offer||[]).map(c=>c.id).join()}`:iAmOfficer?`o|${pd.targetId}|${pd.hand.map(c=>c.id).join()}`:'';\n  if(key===tradeKey) return; tradeKey=key;\n  if(!key){ if($('#sheet').dataset.trade){ closeSheet(); } return; }\n  if(iAmOfficer){\n    const target=g.players.find(p=>p.id===pd.targetId), chosen=new Set();\n    const draw=()=>{\n      openSheet(`<h3>👮 ${esc(target.name)}'s hand</h3><div class=\"reveal\">Take ${pd.take} card${pd.take>1?'s':''}:</div><div class=\"hand\">${pd.hand.map(c=>`<button class=\"card ${c.kind==='act'?'act':''} ${chosen.has(c.id)?'sel':''}\" data-id=\"${c.id}\"><span>${META[c.type].e}</span><small>${META[c.type].n}</small></button>`).join('')}</div><button class=\"btn\" id=\"take\" ${chosen.size===pd.take?'':'disabled'}>Take these</button>`);\n      $('#sheet').dataset.trade='1';\n      $('#sheet').onclick=async(e)=>{\n        const c=e.target.closest('.card'); if(c){ const id=c.dataset.id; chosen.has(id)?chosen.delete(id):(chosen.size<pd.take&&chosen.add(id)); draw(); return; }\n        if(e.target.id==='take'){ const r=await api('/api/action',{code:session.code,pid:session.pid,action:{type:'officerTake',ids:[...chosen]}}); if(!r.ok) toast(r.error); }\n      };\n    };\n    draw(); return;\n  }\n  const from=g.players.find(p=>p.id===t.fromId), to=g.players.find(p=>p.id===t.targetId);\n  const offerHtml=(t.offer||[]).map(c=>`<span class=\"chip\">${META[c.type].e} ${META[c.type].n}</span>`).join('')||`${t.offerCount} card(s)`;\n  const wantHtml=t.want.map(x=>`<span class=\"chip\">${META[x].e} ${META[x].n}</span>`).join('');\n  if(t.targetId===data.you){\n    const have={}; for(const c of g.hand) if(c.kind==='ing') have[c.type]=(have[c.type]||0)+1;\n    const need={}; for(const x of t.want) need[x]=(need[x]||0)+1;\n    const can=Object.keys(need).every(k=>(have[k]||0)>=need[k]);\n    openSheet(`<h3>🔁 ${esc(from.name)} offers a trade</h3><div class=\"reveal\">They give:</div><div>${offerHtml}</div><div class=\"reveal\" style=\"margin-top:8px\">They want from you:</div><div>${wantHtml}</div>${can?'':'<div class=\"reveal\" style=\"color:var(--sambal)\">You don\\'t have those ingredients.</div>'}<button class=\"btn\" id=\"acc\" ${can?'':'disabled'}>Accept</button><button class=\"btn red\" id=\"dec\">Decline</button>`);\n    $('#sheet').dataset.trade='1';\n    $('#sheet').onclick=async(e)=>{ if(e.target.id==='acc') await api('/api/action',{code:session.code,pid:session.pid,action:{type:'tradeRespond',accept:true}}).then(r=>!r.ok&&toast(r.error));\n      if(e.target.id==='dec') await api('/api/action',{code:session.code,pid:session.pid,action:{type:'tradeRespond',accept:false}}); };\n  } else if(t.fromId===data.you){\n    openSheet(`<h3>Waiting for ${esc(to.name)}…</h3><div class=\"reveal\">You give:</div><div>${offerHtml}</div><div class=\"reveal\" style=\"margin-top:8px\">You want:</div><div>${wantHtml}</div><button class=\"btn alt\" id=\"cx\">Cancel offer</button>`);\n    $('#sheet').dataset.trade='1';\n    $('#sheet').onclick=(e)=>{ if(e.target.id==='cx') api('/api/action',{code:session.code,pid:session.pid,action:{type:'tradeCancel'}}); };\n  }\n}\n\nif(session) connect(); else render();\n</script>\n</body>\n</html>\n";
// Bungkus Rush room server. Zero dependencies: plain HTTP + Server-Sent Events.
//   POST /api/create   {name}                  -> {ok, code, pid}
//   POST /api/join     {name, code, pid?}      -> {ok, code, pid}   (pid = rejoin)
//   POST /api/start    {code, pid}             -> {ok}   (host only)
//   POST /api/action   {code, pid, action}     -> {ok} | {ok:false, error}
//   POST /api/lobby    {code, pid}             -> {ok}   (host only: back to lobby / rematch)
//   GET  /api/events?code=&pid=                -> SSE stream of {room, you, game}
//   POST /api/options  {code, pid, expansion}  -> {ok}   (host only, lobby only)
// Also serves ../web (the game itself) so one link works on every phone.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const game = GAME;

const PORT = process.env.PORT || 3000;
const maxPlayers = (room) => (room.expansion ? 7 : 5);
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const rooms = new Map();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(c)) return c;
  }
}
const newId = () => crypto.randomBytes(8).toString('hex');
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);

function snapshot(room, pid) {
  return {
    room: {
      code: room.code,
      hostId: room.hostId,
      expansion: room.expansion,
      maxPlayers: maxPlayers(room),
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: [...room.clients].some((c) => c.pid === p.id),
      })),
    },
    you: pid,
    game: room.game ? game.viewFor(room.game, pid) : null,
  };
}

function broadcast(room) {
  room.touched = Date.now();
  for (const c of room.clients) {
    c.res.write(`data: ${JSON.stringify(snapshot(room, c.pid))}\n\n`);
  }
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => {
      s += d;
      if (s.length > 20000) {
        reject(new Error('too big'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  if (pathname !== '/' && pathname !== '/index.html') { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true, rooms: rooms.size });

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const room = rooms.get((url.searchParams.get('code') || '').toUpperCase());
      const pid = url.searchParams.get('pid');
      if (!room || !room.players.some((p) => p.id === pid)) return send(res, 404, { ok: false, error: 'Room not found' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...CORS,
      });
      res.write('retry: 2000\n\n');
      const client = { pid, res };
      room.clients.add(client);
      res.write(`data: ${JSON.stringify(snapshot(room, pid))}\n\n`);
      const ka = setInterval(() => res.write(': ka\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ka);
        room.clients.delete(client);
        broadcast(room);
      });
      broadcast(room); // tell others this player is connected
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const b = await readBody(req);
      const code = String(b.code || '').toUpperCase();

      if (url.pathname === '/api/create') {
        const name = cleanName(b.name);
        if (!name) return send(res, 200, { ok: false, error: 'Enter a name' });
        const pid = newId();
        const room = { code: newCode(), hostId: pid, players: [{ id: pid, name }], expansion: false, clients: new Set(), game: null, touched: Date.now() };
        rooms.set(room.code, room);
        return send(res, 200, { ok: true, code: room.code, pid });
      }

      const room = rooms.get(code);
      if (!room) return send(res, 200, { ok: false, error: 'Room not found' });

      if (url.pathname === '/api/join') {
        const existing = b.pid && room.players.find((p) => p.id === b.pid);
        if (existing) return send(res, 200, { ok: true, code, pid: existing.id });
        if (room.game) return send(res, 200, { ok: false, error: 'That game has already started' });
        if (room.players.length >= maxPlayers(room)) return send(res, 200, { ok: false, error: 'Room is full' });
        const name = cleanName(b.name);
        if (!name) return send(res, 200, { ok: false, error: 'Enter a name' });
        if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
          return send(res, 200, { ok: false, error: 'That name is taken in this room' });
        }
        const pid = newId();
        room.players.push({ id: pid, name });
        broadcast(room);
        return send(res, 200, { ok: true, code, pid });
      }

      if (!room.players.some((p) => p.id === b.pid)) return send(res, 200, { ok: false, error: 'You are not in this room' });

      if (url.pathname === '/api/start') {
        if (b.pid !== room.hostId) return send(res, 200, { ok: false, error: 'Only the host can start' });
        if (room.players.length < 2) return send(res, 200, { ok: false, error: 'Need at least 2 players' });
        if (room.game && !room.game.over) return send(res, 200, { ok: false, error: 'Already started' });
        const order = room.players.slice().sort(() => Math.random() - 0.5);
        room.game = game.createGame(order, Math.random, { expansion: room.expansion });
        broadcast(room);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/options') {
        if (b.pid !== room.hostId) return send(res, 200, { ok: false, error: 'Only the host can change this' });
        if (room.game && !room.game.over) return send(res, 200, { ok: false, error: 'Game already started' });
        const exp = !!b.expansion;
        if (!exp && room.players.length > 5) return send(res, 200, { ok: false, error: 'The base game fits 5 players - too many in the room' });
        room.expansion = exp;
        broadcast(room);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/lobby') {
        if (b.pid !== room.hostId) return send(res, 200, { ok: false, error: 'Only the host can do that' });
        room.game = null;
        broadcast(room);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === '/api/action') {
        if (!room.game) return send(res, 200, { ok: false, error: 'Game not started' });
        const r = game.apply(room.game, b.pid, b.action);
        if (r.ok) broadcast(room);
        return send(res, 200, r);
      }
    }

    if (req.method === 'GET') return serveStatic(req, res, decodeURIComponent(url.pathname));
    send(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    send(res, 400, { ok: false, error: 'Bad request' });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && now - room.touched > ROOM_TTL_MS) rooms.delete(code);
  }
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Bungkus Rush server on :${PORT}`));
}
module.exports = server;
