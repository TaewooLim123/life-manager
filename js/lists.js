// Grocery + shopping lists.
// Items are never thrown away when you clear the cart: they're archived and become
// "Buy again" suggestions, ranked by how often you've bought them.
import { store } from './store.js';
import { uid, esc } from './util.js';
import { icons } from './icons.js';

export const LISTS = { grocery: 'Groceries', shopping: 'Shopping' };

// Store-walk order. Keywords match whole words, with or without a trailing "s"/"es".
export const AISLES = [
  ['produce', 'Produce', 'apple banana orange lemon lime avocado tomato potato onion garlic ginger carrot celery lettuce spinach kale cabbage broccoli cauliflower pepper cucumber zucchini mushroom berry strawberry blueberry raspberry grape melon watermelon mango pineapple peach pear cilantro parsley basil scallion herb fruit veggie vegetable salad corn bean sprout jalapeno'],
  ['bakery', 'Bakery', 'bread bagel tortilla bun roll croissant muffin baguette pita naan cake donut'],
  ['dairy', 'Dairy & eggs', 'milk egg butter cheese yogurt yoghurt cream sour creamer kefir tofu oatmilk'],
  ['meat', 'Meat & seafood', 'chicken beef pork turkey bacon sausage ham steak salmon tuna shrimp fish lamb ground meat'],
  ['frozen', 'Frozen', 'frozen ice dumpling pizza fries waffle'],
  ['pantry', 'Pantry', 'rice pasta noodle ramen flour sugar salt oil vinegar sauce soy ketchup mustard mayo honey cereal oat oatmeal peanut jam spice cinnamon broth soup can lentil chickpea quinoa kimchi seasoning syrup'],
  ['snacks', 'Snacks', 'chip cracker cookie chocolate candy popcorn nut almond granola pretzel snack bar'],
  ['drinks', 'Drinks', 'water juice soda coffee tea beer wine kombucha sparkling gatorade energy'],
  ['household', 'Household', 'paper towel toilet tissue detergent soap dish sponge trash bag foil wrap battery bulb cleaner bleach napkin'],
  ['personal', 'Personal care', 'shampoo conditioner toothpaste toothbrush floss deodorant lotion razor sunscreen vitamin medicine tylenol advil bandage'],
  ['other', 'Other', ''],
];
const AISLE_WORDS = AISLES.map(([k, , words]) => [k, new Set(words.split(' ').filter(Boolean))]);

// Two-word names where the last word alone would pick the wrong aisle.
const PHRASES = {
  'peanut butter': 'pantry', 'almond butter': 'pantry', 'coconut milk': 'pantry', 'ice cream': 'frozen',
  'paper towel': 'household', 'toilet paper': 'household', 'dish soap': 'household', 'hand soap': 'personal',
  'trash bag': 'household', 'coffee bean': 'drinks', 'body wash': 'personal', 'cream cheese': 'dairy', 'sour cream': 'dairy',
};

export function guessAisle(name) {
  const lower = name.toLowerCase();
  for (const [p, k] of Object.entries(PHRASES)) if (lower.includes(p)) return k;
  const words = lower.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  // The last word usually names the thing ("chocolate milk" -> dairy, "frozen pizza" -> frozen).
  for (const w of [...words].reverse()) {
    const forms = [w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')];
    for (const [k, set] of AISLE_WORDS) if (forms.some((f) => set.has(f))) return k;
  }
  return 'other';
}

const UNITS = 'lbs?|oz|kg|g|gal|gallons?|l|liters?|dozen|doz|packs?|bags?|cans?|bottles?|boxes?|bunch(?:es)?|cartons?|loaf|loaves';

/** "2 milk" | "milk x2" | "2 lb chicken" | "chicken 2 lb" -> { name, qty } */
export function parseItem(text) {
  let t = text.trim().replace(/\s+/g, ' ');
  let qty = '';
  let m = t.match(new RegExp(`^(\\d+(?:[.,/]\\d+)?)\\s*(${UNITS})?\\s+(.+)$`, 'i'));
  if (m) { qty = m[2] ? `${m[1]} ${m[2]}` : m[1]; t = m[3]; }
  else if ((m = t.match(new RegExp(`^(.+?)\\s+(?:x\\s*)?(\\d+(?:[.,/]\\d+)?)\\s*(${UNITS})?$`, 'i'))) && (m[3] || /x\s*\d/i.test(t))) {
    t = m[1]; qty = m[3] ? `${m[2]} ${m[3]}` : m[2];
  }
  return { name: t.charAt(0).toUpperCase() + t.slice(1), qty };
}

const allItems = (list) => store.list('item').filter((i) => i.list === list);
export const activeItems = (list) => allItems(list).filter((i) => !i.archived);
export const openCount = (list) => activeItems(list).filter((i) => !i.checked).length;

export async function addItems(list, text) {
  const parts = text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const all = allItems(list);
  const added = [], dupes = [];
  const batch = [];
  for (const part of parts) {
    const { name, qty } = parseItem(part);
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = all.find((i) => i.name.toLowerCase() === key);
    if (existing && !existing.archived && !existing.checked) { dupes.push(name); continue; }
    const base = existing || { id: uid(), list, name, aisle: list === 'grocery' ? guessAisle(name) : 'other', count: 0 };
    batch.push(['item', { ...base, name, qty, checked: false, archived: false, count: (base.count || 0) + 1, addedAt: new Date().toISOString() }]);
    added.push(name);
  }
  if (batch.length) await store.putMany(batch);
  return { added, dupes };
}

export async function toggleItem(id) {
  const it = store.get(id);
  if (!it) return;
  await store.patch(id, { checked: !it.checked, checkedAt: it.checked ? null : new Date().toISOString() });
}

export async function clearChecked(list) {
  const done = activeItems(list).filter((i) => i.checked);
  await store.putMany(done.map((i) => ['item', { ...i, checked: false, archived: true }]));
  return done;
}
export async function unclear(items) {
  await store.putMany(items.map((i) => ['item', { ...i, checked: true, archived: false }]));
}

/** Previously bought items that aren't on the list now, most frequent first. */
export function suggestions(list, limit = 10) {
  return allItems(list).filter((i) => i.archived)
    .sort((a, b) => (b.count || 0) - (a.count || 0) || (b.addedAt || '').localeCompare(a.addedAt || ''))
    .slice(0, limit);
}

// ---------- rendering ----------
function row(i) {
  return `<div class="item list-item ${i.checked ? 'done' : ''}">
    <button class="check sq" data-action="item-toggle" data-id="${i.id}" aria-pressed="${!!i.checked}" aria-label="${i.checked ? 'Uncheck' : 'Check'} ${esc(i.name)}">${icons.check}</button>
    <button class="item-main" data-action="edit" data-kind="item" data-id="${i.id}">
      <div class="item-title">${esc(i.name)}</div>
      ${i.note ? `<div class="item-meta">${esc(i.note)}</div>` : ''}
    </button>
    ${i.qty ? `<span class="qty">${esc(i.qty)}</span>` : '<span></span>'}
  </div>`;
}

export function renderList(list) {
  const items = activeItems(list);
  const open = items.filter((i) => !i.checked).sort((a, b) => a.name.localeCompare(b.name));
  const done = items.filter((i) => i.checked).sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || ''));
  const sugg = suggestions(list);
  const isGrocery = list === 'grocery';

  let html = `<form class="quick-add" data-form="item" data-list="${list}">
      <input class="input" name="q" type="text" placeholder="${isGrocery ? 'Add items… (2 milk, eggs, bananas)' : 'Add something to buy…'}" autocomplete="off" enterkeyhint="done" aria-label="Add to ${LISTS[list]}">
      <button class="btn primary" type="submit">Add</button></form>`;

  if (sugg.length) {
    html += `<div class="buy-again"><span class="field-label">Buy again</span><div class="opts">${sugg.map((s) =>
      `<button class="opt" data-action="item-again" data-list="${list}" data-name="${esc(s.name)}">+ ${esc(s.name)}</button>`).join('')}</div></div>`;
  }

  if (!open.length && !done.length) {
    html += `<div class="empty"><strong>${isGrocery ? 'Fridge is stocked?' : 'Nothing to buy'}</strong>${isGrocery
      ? 'Add a few items. Use commas to add several at once; they sort into store aisles automatically.'
      : 'For non-grocery things: a phone charger, textbooks, a birthday gift.'}</div>`;
    return html;
  }

  if (open.length) {
    if (isGrocery) {
      for (const [k, label] of AISLES) {
        const xs = open.filter((i) => (i.aisle || 'other') === k);
        if (!xs.length) continue;
        html += `<div class="day-group"><h3 class="day-label">${label}<small>${xs.length}</small></h3><div class="list">${xs.map(row).join('')}</div></div>`;
      }
    } else {
      html += `<div class="list" style="margin-bottom:18px">${open.map(row).join('')}</div>`;
    }
  } else {
    html += `<div class="empty" style="margin-bottom:18px"><strong>All in the cart</strong>Clear it when you’re done so these show up under Buy again next time.</div>`;
  }

  if (done.length) {
    html += `<div class="section-head" style="margin-top:8px"><h2 class="section-title">In cart</h2><span class="section-count">${done.length}</span><span class="section-rule"></span>
      <button class="section-link" data-action="clear-checked" data-list="${list}">Clear</button></div>
      <div class="list">${done.map(row).join('')}</div>`;
  }
  return html;
}
