(() => {
  "use strict";
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").replace(/[’]/g, "'").trim().toLowerCase();
  const isVisible = (node) => {
    if (!(node instanceof Element) || !node.isConnected) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  };
  const safeQuery = (selector, root = document) => {
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  };
  const bySelector = (selectors) => {
    for (const selector of selectors ?? []) {
      const matches = safeQuery(selector).filter(isVisible);
      if (matches.length) return matches;
    }
    return [];
  };

  function controlName(control) {
    const pieces = [control.getAttribute("aria-label"), control.getAttribute("placeholder")];
    if (control.id) {
      const associated = safeQuery("label[for]").find((label) => label.htmlFor === control.id);
      if (associated) pieces.push(associated.textContent);
    }
    if (control.labels) pieces.push(...[...control.labels].map((label) => label.textContent));
    pieces.push(control.closest("label")?.textContent);
    if (control.name) pieces.push(control.name.replace(/[_-]+/g, " "));
    if (control.id) pieces.push(control.id.replace(/[_-]+/g, " "));
    return pieces.filter(Boolean).map(normalize);
  }

  function findField(item) {
    const exact = (item.selectors ?? []).flatMap((selector) => safeQuery(selector))
      .filter((node) => node.matches("input,select,textarea") && (isVisible(node) || node instanceof HTMLSelectElement))
      .sort((left, right) => Number(isVisible(right)) - Number(isVisible(left)));
    if (exact.length) return exact[item.index] ?? (item.index === 0 ? exact[0] : null);
    const labels = (item.labels ?? []).map(normalize);
    if (!labels.length) return null;
    const candidates = safeQuery("input:not([type=hidden]):not([type=radio]):not([type=checkbox]),select,textarea")
      .filter((node) => isVisible(node) && !node.disabled)
      .map((node) => {
        const names = controlName(node);
        let score = 0;
        for (const label of labels) {
          for (const name of names) {
            if (name === label) score = Math.max(score, 100);
            else if (label.length >= 8 && name.includes(label)) score = Math.max(score, 70);
          }
        }
        return { node, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) return null;
    const best = candidates.filter((candidate) => candidate.score === candidates[0].score);
    return best[item.index]?.node ?? (best.length === 1 && labels.some((label) => label.includes(`applicant ${item.index + 1}`)) ? best[0].node : null);
  }

  function setValue(control, value) {
    if (control instanceof HTMLSelectElement) {
      const option = [...control.options].find((candidate) => normalize(candidate.value) === normalize(value) || normalize(candidate.textContent) === normalize(value)) ||
        [...control.options].find((candidate) => normalize(candidate.textContent).startsWith(normalize(value)));
      if (!option) return false;
      if (control.value === option.value) return true;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      if (setter) setter.call(control, option.value); else control.value = option.value;
    } else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      if (control.value === value) return true;
      const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(control, value); else control.value = value;
    } else return false;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function chooseInScope(scope, value, index = 0) {
    const target = normalize(value);
    for (const select of safeQuery("select", scope).filter(isVisible)) {
      if (setValue(select, value)) return true;
    }
    const nodes = safeQuery("label,button,[role=radio],[role=option]", scope)
      .filter(isVisible)
      .filter((node) => normalize(node.textContent) === target || normalize(node.getAttribute("aria-label")) === target);
    if (nodes[index]) {
      const control = nodes[index] instanceof HTMLLabelElement ? nodes[index].control : null;
      if (control?.checked) return true;
      nodes[index].click();
      return true;
    }
    const radios = safeQuery('input[type="radio"],input[type="checkbox"]', scope).filter(isVisible)
      .filter((node) => normalize(node.value) === target || controlName(node).includes(target));
    if (radios[index]) {
      if (!radios[index].checked) radios[index].click();
      return true;
    }
    return false;
  }

  function chooseAfterQuestion(groups, value) {
    const markers = safeQuery("label,p,h1,h2,h3,h4,span,div").filter(isVisible)
      .filter((node) => groups.some((group) => normalize(node.textContent).includes(normalize(group))))
      .filter((node) => normalize(node.textContent).length < 180)
      .sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length);
    const target = normalize(value);
    for (const marker of markers.slice(0, 4)) {
      const top = marker.getBoundingClientRect().top;
      const buttons = safeQuery("button,label,[role=button],[role=radio]").filter(isVisible)
        .filter((node) => normalize(node.textContent) === target || normalize(node.getAttribute("aria-label")) === target)
        .map((node) => ({ node, distance: node.getBoundingClientRect().top - top }))
        .filter(({ distance }) => distance >= -10 && distance < 500)
        .sort((left, right) => left.distance - right.distance);
      if (buttons[0]) { buttons[0].node.click(); return true; }
    }
    return false;
  }

  function choose(item) {
    const direct = (item.selectors ?? []).flatMap((selector) => safeQuery(selector));
    if (direct.length) {
      const control = direct[0];
      if (control instanceof HTMLSelectElement) return setValue(control, item.value);
      if (control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox")) {
        if (!control.checked) {
          const label = control.id ? safeQuery("label[for]").find((candidate) => candidate.htmlFor === control.id && isVisible(candidate)) : null;
          if (label) label.click(); else control.click();
        }
        return true;
      }
      control.click();
      return true;
    }
    const groups = (item.groups ?? []).map(normalize);
    for (const scope of safeQuery("fieldset,[role=group],[role=radiogroup]").filter(isVisible)) {
      const heading = normalize(scope.getAttribute("aria-label") || scope.querySelector("legend")?.textContent || scope.querySelector("h1,h2,h3,h4")?.textContent);
      if (groups.some((group) => heading.includes(group)) && chooseInScope(scope, item.value, item.index)) return true;
    }
    if (groups.length && chooseAfterQuestion(item.groups, item.value)) return true;
    if (!groups.length) return chooseInScope(document, item.value, item.index);
    return false;
  }

  function chooseProduct(item) {
    const select = document.querySelector("#product1");
    if (!(select instanceof HTMLSelectElement)) return false;
    const options = [...select.options].map((option, index) => ({ option, index, label: option.textContent?.trim() ?? "" }));
    const matches = options
      .filter(({ label }) => new RegExp(`${item.initialPeriod}yr`, "i").test(label) && new RegExp(`\\b${item.ltvBucket}\\b`).test(label))
      .map((entry) => ({ ...entry, rate: Number(entry.label.match(/([0-9]+(?:\.[0-9]+)?)%\s*$/)?.[1] ?? "999") }))
      .sort((left, right) => left.rate - right.rate || left.index - right.index);
    const chosen = matches[0] ?? options.find(({ label }) => /Default 5yr/i.test(label)) ?? options.find(({ index }) => index > 0);
    if (!chosen) return false;
    if (select.selectedIndex !== chosen.index) {
      select.selectedIndex = chosen.index;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return select.selectedIndex === chosen.index;
  }

  function anchorVisible(anchor) {
    if (bySelector(anchor.selectors).length) return true;
    for (const label of anchor.labels ?? []) {
      if (findField({ selectors: [], labels: [label], index: 0 })) return true;
    }
    const headingText = safeQuery("h1,h2,h3,h4,legend,[role=heading]").filter(isVisible).map((node) => normalize(node.textContent));
    return (anchor.text ?? []).some((text) => headingText.some((heading) => heading.includes(normalize(text))));
  }

  function activeStep(steps) {
    // Later steps win when a site keeps earlier sections mounted but hidden or summarized.
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (anchorVisible(steps[index].anchor)) return index;
    }
    return -1;
  }

  function nextButton(labels) {
    const candidates = safeQuery('button,input[type="button"],input[type="submit"],a').filter(isVisible);
    for (const label of labels) {
      const wanted = normalize(label);
      const button = candidates.find((candidate) => {
        const text = normalize(candidate.textContent || candidate.value || candidate.getAttribute("aria-label"));
        return (text === wanted || text.startsWith(`${wanted} `)) && !/calculate|result|submit|check affordability|show borrowing/i.test(text);
      });
      if (button && !button.disabled) return button;
    }
    return null;
  }

  function createNotice() {
    const host = document.createElement("div");
    host.id = "affordability-extension-status";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "closed" });
    const panel = document.createElement("div");
    panel.style.cssText = "font:13px Arial,sans-serif;background:#102a43;color:white;padding:12px 14px;border-radius:8px;box-shadow:0 4px 18px #0005;max-width:300px;line-height:1.4";
    const message = document.createElement("span");
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss extension status");
    close.style.cssText = "background:none;border:0;color:white;float:right;font-size:18px;cursor:pointer;margin:-4px -4px 0 8px";
    close.addEventListener("click", () => host.remove());
    panel.append(close, message);
    shadow.append(panel);
    document.documentElement.append(host);
    return (text) => { message.textContent = text; host.setAttribute("aria-label", text); };
  }

  async function dismissCookies() {
    const selectors = ["#onetrust-reject-all-handler", "#onetrust-accept-btn-handler"];
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && isVisible(button)) { button.click(); await delay(500); return; }
    }
    const button = safeQuery("button").filter(isVisible).find((candidate) => /^(reject optional cookies|accept all cookies|allow essential cookies only|reject all|accept all)$/i.test(candidate.textContent.trim()));
    if (button) { button.click(); await delay(500); }
  }

  async function fillStep(current, update) {
    const completed = new Set();
    let idlePasses = 0;
    for (let pass = 0; pass < 20; pass += 1) {
      let progress = 0;
      for (const item of current.items) {
        if (completed.has(item.name)) continue;
        const filled = item.kind === "choice" ? choose(item) : item.kind === "product" ? chooseProduct(item) : (() => {
          const control = findField(item);
          return control ? setValue(control, item.value) : false;
        })();
        if (filled) { completed.add(item.name); progress += 1; }
      }
      idlePasses = progress ? 0 : idlePasses + 1;
      const requiredLeft = current.items.some((item) => item.required && !completed.has(item.name));
      if (!requiredLeft && idlePasses >= 2) break;
      await delay(500);
    }
    for (const item of current.items) {
      if (item.kind === "product" && completed.has(item.name)) {
        const productSelect = document.querySelector("#product1");
        if (productSelect instanceof HTMLSelectElement && productSelect.selectedIndex <= 0) chooseProduct(item);
      }
      if (item.kind !== "field" || !completed.has(item.name) || !item.value) continue;
      const control = findField(item);
      if (control && (!control.value || (control.value === "0" && Number(item.value) > 0))) setValue(control, item.value);
    }
    await delay(250);
    for (const item of current.items.filter((candidate) => candidate.required)) {
      if (item.kind === "field") {
        const currentValue = findField(item)?.value;
        if (!currentValue || (currentValue === "0" && Number(item.value) > 0)) completed.delete(item.name);
      }
      if (item.kind === "product" && document.querySelector("#product1")?.selectedIndex <= 0) completed.delete(item.name);
    }
    const missing = current.items.filter((item) => item.required && !completed.has(item.name)).map((item) => item.name);
    update(missing.length ? `Some required fields need manual review: ${missing.join(", ")}.` : `${current.name}: fields filled. Continuing where needed…`);
    return missing;
  }

  async function run() {
    const response = await chrome.runtime.sendMessage({ type: "GET_CALCULATOR_JOB" });
    if (!response?.ok || !response.job) return;
    const { lender, input } = response.job;
    const update = createNotice();
    update(`Opening ${lender.replace(/_/g, " ")} calculator…`);
    await dismissCookies();
    let steps;
    try { steps = globalThis.AffordabilityFillPlan.forLender(lender, input); }
    catch (error) { update(error.message); return; }
    let index = -1;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      index = activeStep(steps);
      if (index >= 0) break;
      await delay(500);
    }
    if (index < 0) {
      update("The lender form did not appear. Sign in or open the calculator, then click the website button again.");
      return;
    }
    await delay(1000);
    await dismissCookies();
    for (let transitions = 0; transitions < steps.length; transitions += 1) {
      const current = steps[index];
      update(`Filling ${current.name}…`);
      let missing = await fillStep(current, update);
      if (lender === "santander" && current.name === "Mortgage details") {
        const patch = await chrome.runtime.sendMessage({ type: "PATCH_SANTANDER_DETAILS" }).catch((error) => ({ ok: false, error: String(error) }));
        if (!patch?.ok) console.warn("Santander details could not be synced:", patch?.error ?? "Unknown error");
        for (let attempt = 0; attempt < 30 && missing.length; attempt += 1) {
          await delay(300);
          missing = missing.filter((name) => {
            const item = current.items.find((candidate) => candidate.name === name);
            const value = item?.kind === "field" ? (item.selectors ?? []).map((selector) => document.querySelector(selector)?.value).find(Boolean) ?? findField(item)?.value : null;
            return !value || (value === "0" && Number(item.value) > 0);
          });
        }
        if (!missing.length) update("Mortgage details filled. Continuing where needed…");
      }
      if (missing.length) break;
      if (!current.next.length || index === steps.length - 1) {
        update("Automatic fill finished. Review every field, then calculate on the lender site.");
        break;
      }
      const button = nextButton(current.next);
      if (!button) {
        update(`${current.name} filled. Continue manually to the next step; the extension will not calculate for you.`);
        break;
      }
      button.click();
      let next = -1;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await delay(300);
        next = activeStep(steps);
        if (next > index) break;
      }
      if (next <= index) {
        update("The lender did not advance. Check its validation messages and continue manually.");
        break;
      }
      index = next;
    }
    await chrome.runtime.sendMessage({ type: "CALCULATOR_DONE" }).catch(() => undefined);
  }

  run().catch((error) => {
    console.error("Affordability extension fill failed:", error);
  });
})();
