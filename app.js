/** Plik jadłospisu w katalogu projektu (serwowany przez lokalny serwer HTTP). */
const DIET_FILE = "nowe_diety_10dni_1800_2400_kolejny_zestaw.md";

const reloadButton = document.getElementById("reload-btn");
const statusEl = document.getElementById("status");
const contentEl = document.getElementById("content");
const dayCheckboxesEl = document.getElementById("day-checkboxes");
const selectAllDaysBtn = document.getElementById("select-all-days-btn");
const clearAllDaysBtn = document.getElementById("clear-all-days-btn");
const generateShoppingBtn = document.getElementById("generate-shopping-btn");
const clearShoppingBtn = document.getElementById("clear-shopping-btn");
const shoppingListEl = document.getElementById("shopping-list");

let currentDietDays = [];

function setStatus(message) {
  statusEl.textContent = message;
}

function isDayHeading(text) {
  return /^dzien\s+\d+/i.test(text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

function createCollapsibleSection(title, className, isOpen) {
  const details = document.createElement("details");
  details.className = className;
  details.open = isOpen;

  const summary = document.createElement("summary");
  summary.textContent = title;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = `${className}__body`;
  details.appendChild(body);

  return { details, body };
}

function cleanCell(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUnit(unit) {
  const lower = unit.toLowerCase();
  if (lower === "kg") {
    return { unit: "g", multiplier: 1000 };
  }
  if (lower === "l") {
    return { unit: "ml", multiplier: 1000 };
  }
  if (lower.startsWith("szt")) {
    return { unit: "szt", multiplier: 1 };
  }
  return { unit: lower, multiplier: 1 };
}

function parseNumericAmount(rawValue) {
  const match = rawValue.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|szt\.?|ząbek|ząbki|ząbka)/i);
  if (!match) {
    return null;
  }

  const numeric = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = normalizeUnit(match[2]);
  return {
    value: numeric * normalized.multiplier,
    unit: normalized.unit,
  };
}

function formatAmount(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1).replace(".0", "");
}

function parseDietFromMarkdown(markdown) {
  const days = [];
  const lines = markdown.split(/\r?\n/);
  let currentDay = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      const headingText = cleanCell(headingMatch[1]);
      if (isDayHeading(headingText)) {
        currentDay = { title: headingText, items: [] };
        days.push(currentDay);
      } else {
        currentDay = null;
      }
      continue;
    }

    if (!currentDay || !line.trim().startsWith("|")) {
      continue;
    }

    if (/^\|\s*-+/.test(line.trim())) {
      continue;
    }

    const cells = line.split("|").map((cell) => cleanCell(cell));
    const values = cells.filter(Boolean);
    if (values.length < 3) {
      continue;
    }

    const ingredient = values[0];
    const amount1800 = values[1];
    const amount2400 = values[2];

    const normalizedIngredient = ingredient.toLowerCase();
    if (normalizedIngredient === "składnik" || normalizedIngredient === "skladnik") {
      continue;
    }

    currentDay.items.push({
      ingredient,
      amount1800,
      amount2400,
    });
  }

  return days;
}

function renderDaySelector(days) {
  dayCheckboxesEl.innerHTML = "";

  if (!days.length) {
    dayCheckboxesEl.innerHTML = "<p>Brak wykrytych dni.</p>";
    return;
  }

  days.forEach((day, index) => {
    const wrapper = document.createElement("label");
    wrapper.className = "day-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(index);
    checkbox.checked = true;

    const labelText = document.createElement("span");
    labelText.textContent = day.title;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(labelText);
    dayCheckboxesEl.appendChild(wrapper);
  });
}

function getSelectedDayIndexes() {
  const checked = dayCheckboxesEl.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checked).map((el) => Number.parseInt(el.value, 10));
}

function setAllDaysChecked(isChecked) {
  const all = dayCheckboxesEl.querySelectorAll('input[type="checkbox"]');
  all.forEach((checkbox) => {
    checkbox.checked = isChecked;
  });
}

function addVariantAmount(entry, key, rawAmount) {
  const parsed = parseNumericAmount(rawAmount);
  if (parsed) {
    const current = entry[key].parsed.get(parsed.unit) ?? 0;
    entry[key].parsed.set(parsed.unit, current + parsed.value);
    return;
  }

  if (rawAmount) {
    entry[key].notes.add(rawAmount);
  }
}

function formatVariantAmount(variant) {
  const parsedParts = Array.from(variant.parsed.entries())
    .map(([unit, value]) => `${formatAmount(value)} ${unit}`)
    .sort((a, b) => a.localeCompare(b, "pl"));

  const noteParts = Array.from(variant.notes);
  const parts = [...parsedParts, ...noteParts];
  return parts.length ? parts.join(" + ") : "-";
}

function buildTotalVariant(for1800, for2400) {
  const total = {
    parsed: new Map(),
    notes: new Set([...for1800.notes, ...for2400.notes]),
  };

  for (const [unit, value] of for1800.parsed.entries()) {
    total.parsed.set(unit, (total.parsed.get(unit) ?? 0) + value);
  }

  for (const [unit, value] of for2400.parsed.entries()) {
    total.parsed.set(unit, (total.parsed.get(unit) ?? 0) + value);
  }

  return total;
}

function getProductCategory(ingredient) {
  const name = ingredient.toLowerCase();

  if (/kurczak|wołow|wolow|indyk|tuńczyk|tunczyk|łosoś|losos|ryba|jajk|twaróg|twarog|skyr|jogurt|ser|mleko/.test(name)) {
    return "Białko i nabiał";
  }
  if (/ryż|ryz|kasza|makaron|płatki|platki|pieczywo|tortilla|chleb|mąka|maka/.test(name)) {
    return "Produkty zbożowe";
  }
  if (/oliwa|olej|masło|maslo|awokado|orzech|pestki/.test(name)) {
    return "Tłuszcze";
  }
  if (/jabłko|jablko|banan|borówk|borowk|malin|truskawk|owoc|cytryn/.test(name)) {
    return "Owoce";
  }
  if (/brokuł|brokul|papryk|ogórek|ogorek|rukol|sałat|salat|pomidor|cukini|marchew|ziemniak|cebula|czosnek/.test(name)) {
    return "Warzywa";
  }
  if (/sól|sol|pieprz|zioła|ziola|cynamon|kakao|erytrol|miód|miod|musztarda|sok/.test(name)) {
    return "Przyprawy i dodatki";
  }

  return "Pozostałe";
}

function aggregateShoppingItems(selectedIndexes) {
  const map = new Map();

  for (const dayIndex of selectedIndexes) {
    const day = currentDietDays[dayIndex];
    if (!day) {
      continue;
    }

    for (const item of day.items) {
      const key = item.ingredient.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          ingredient: item.ingredient,
          for1800: { parsed: new Map(), notes: new Set() },
          for2400: { parsed: new Map(), notes: new Set() },
        });
      }

      const entry = map.get(key);
      addVariantAmount(entry, "for1800", item.amount1800);
      addVariantAmount(entry, "for2400", item.amount2400);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.ingredient.localeCompare(b.ingredient, "pl"));
}

function renderShoppingList(items, selectedIndexes) {
  if (!selectedIndexes.length) {
    shoppingListEl.innerHTML = "<p>Zaznacz przynajmniej jeden dzień.</p>";
    return;
  }

  if (!items.length) {
    shoppingListEl.innerHTML = "<p>Brak danych do wygenerowania listy.</p>";
    return;
  }

  const selectedTitles = selectedIndexes.map((index) => currentDietDays[index]?.title).filter(Boolean);

  const grouped = new Map();
  for (const item of items) {
    const category = getProductCategory(item.ingredient);
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category).push(item);
  }

  const categoryOrder = [
    "Warzywa",
    "Owoce",
    "Białko i nabiał",
    "Produkty zbożowe",
    "Tłuszcze",
    "Przyprawy i dodatki",
    "Pozostałe",
  ];

  const categorySections = categoryOrder
    .filter((category) => grouped.has(category))
    .map((category) => {
      const rows = grouped
        .get(category)
        .map((item) => {
          const amount1800 = formatVariantAmount(item.for1800);
          const amount2400 = formatVariantAmount(item.for2400);
          const totalAmount = formatVariantAmount(buildTotalVariant(item.for1800, item.for2400));
          return `<tr><td>${item.ingredient}</td><td>${amount1800}</td><td>${amount2400}</td><td>${totalAmount}</td></tr>`;
        })
        .join("");

      return `
        <section class="shopping-category">
          <h4>${category}</h4>
          <table>
            <thead>
              <tr>
                <th>Skladnik</th>
                <th>Suma dla 1800</th>
                <th>Suma dla 2400</th>
                <th>Suma (1800 + 2400)</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  shoppingListEl.innerHTML = `
    <h3>Lista zakupow</h3>
    <p class="shopping-meta">Wybrane dni: ${selectedTitles.join(", ")}</p>
    ${categorySections}
  `;
}

function wrapMealsInDay(dayBody) {
  let node = dayBody.firstChild;

  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "H3") {
      const title = node.textContent.trim();
      const { details, body } = createCollapsibleSection(title, "meal-section", false);
      const mealStart = node.nextSibling;

      dayBody.insertBefore(details, node);
      dayBody.removeChild(node);

      let mealNode = mealStart;
      while (mealNode && !(mealNode.nodeType === Node.ELEMENT_NODE && mealNode.tagName === "H3")) {
        const afterMoved = mealNode.nextSibling;
        body.appendChild(mealNode);
        mealNode = afterMoved;
      }

      node = mealNode;
      continue;
    }

    node = node.nextSibling;
  }
}

function enableCollapsibleDietView() {
  const children = Array.from(contentEl.childNodes);
  let index = 0;
  let dayCount = 0;

  while (index < children.length) {
    const current = children[index];

    if (current.nodeType === Node.ELEMENT_NODE && current.tagName === "H2" && isDayHeading(current.textContent.trim())) {
      dayCount += 1;
      const title = current.textContent.trim();
      const { details, body } = createCollapsibleSection(title, "day-section", dayCount === 1);

      contentEl.insertBefore(details, current);
      contentEl.removeChild(current);

      index += 1;
      while (
        index < children.length &&
        !(
          children[index].nodeType === Node.ELEMENT_NODE &&
          children[index].tagName === "H2" &&
          isDayHeading(children[index].textContent.trim())
        )
      ) {
        body.appendChild(children[index]);
        index += 1;
      }

      wrapMealsInDay(body);
      continue;
    }

    index += 1;
  }
}

async function loadDiet(fileName) {
  setStatus(`Ladowanie: ${fileName}`);

  try {
    const response = await fetch(fileName, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Nie udalo sie wczytac pliku (${response.status})`);
    }

    const markdown = await response.text();
    const html = marked.parse(markdown);
    contentEl.innerHTML = html;
    currentDietDays = parseDietFromMarkdown(markdown);
    renderDaySelector(currentDietDays);
    shoppingListEl.innerHTML = "";
    enableCollapsibleDietView();
    setStatus(`Wyswietlono: ${fileName}`);
  } catch (error) {
    contentEl.innerHTML = "";
    dayCheckboxesEl.innerHTML = "";
    shoppingListEl.innerHTML = "";
    setStatus(`Blad: ${error.message}`);
  }
}

reloadButton.addEventListener("click", () => {
  loadDiet(DIET_FILE);
});

selectAllDaysBtn.addEventListener("click", () => {
  setAllDaysChecked(true);
});

clearAllDaysBtn.addEventListener("click", () => {
  setAllDaysChecked(false);
});

generateShoppingBtn.addEventListener("click", () => {
  const selectedIndexes = getSelectedDayIndexes();
  const aggregated = aggregateShoppingItems(selectedIndexes);
  renderShoppingList(aggregated, selectedIndexes);
});

clearShoppingBtn.addEventListener("click", () => {
  shoppingListEl.innerHTML = "";
});

loadDiet(DIET_FILE);
