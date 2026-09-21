# Tax Handling Research — AI Invoice & Bookkeeping Tool (India)

*Prepared for the product team. Rules are dated to **FY/AY 2025‑26** unless noted. **Indian tax rates change every Union Budget (Feb) and via GST Council meetings — re‑verify before shipping any hard‑coded rate.** Sources are linked inline. "**Rec:**" marks a recommendation (opinion); everything else is sourced fact.*

---

## 1. TL;DR / Recommendations

For a small‑business invoice/bookkeeping tool, the practical answer is:

1. **Treat GST as a balance‑sheet pass‑through, never as revenue or expense.** Book sales/purchases **net of GST**; output GST is a *liability*, input GST (ITC) is an *asset*, and **GST payable = output − input**. This is exactly what the current dashboard figure represents — keep it, but move the underlying postings off the P&L. ([ICAI Handbook on Finalisation of Accounts with GST perspective](https://idtc-icai.s3.ap-southeast-1.amazonaws.com/download/pdf20/Handbook-on-Finalisation-of-Accounts-with-GST-perspective-23-12-2020.pdf))

2. **Stop inferring GST purely from whether the invoice itemised it.** Add three first‑class flags so a "no‑GST total" is never silently booked as ₹0 tax: **(a) a registration setting** ("Am I GST‑registered? GSTIN? Composition?"), **(b) a per‑invoice pricing toggle** — *GST‑exclusive / GST‑inclusive / Exempt/Nil / Zero‑rated / RCM*, and **(c) a per‑customer/vendor GST treatment** (Registered / Unregistered / Consumer / SEZ / Overseas). This mirrors Zoho Books and is the single biggest correctness fix. ([Zoho Books GST treatment formats](https://www.zoho.com/in/books/kb/gst/gst-import-format.html))

3. **For the "taxable sale shown with no GST" edge case, default to FLAG, not ₹0.** If the seller is GST‑registered and the supply is taxable, a missing GST line is most often a **GST‑inclusive** price → back it out with `tax = total − total×100/(100+rate)`. Only book ₹0 GST when the supply is genuinely **exempt/nil‑rated**, the seller is **unregistered/composition**, or it's a **B2C‑inclusive** sale you've explicitly marked. Make the default an amber review flag with a one‑click "inclusive at standard rate / exempt / unregistered" resolution.

4. **Income/corporate tax on the P&L = a single "Provision for Tax (estimated)" line below operating profit.** Don't build a tax engine. Compute a *rough estimate* from entity type (proprietor slabs / firm‑LLP 30% / company 22–30%) on net profit, label it clearly as an estimate until the return is filed, and let the user override. Offer **presumptive (44AD/44ADA)** as a simpler alternative estimate for tiny businesses.

5. **Add the split.** Capture **CGST/SGST vs IGST** (driven by place‑of‑supply = intra‑ vs inter‑state) and the **GST rate** per line, not just a lump `tax`. Every Indian competitor does this; GSTR‑1/3B summaries are impossible without it.

6. **Roadmap priority for missing taxes:** *Must‑have* — CGST/SGST/IGST split, GST rate, inclusive/exclusive handling, exempt/zero‑rated tags, RCM flag, GST‑payable as balance‑sheet, income‑tax provision estimate. *Nice‑to‑have* — TDS payable/receivable, professional tax, composition tax, GSTR‑1/3B export. *Skip for v1* — capital gains, customs/import IGST detail, TCS, cess on sin goods (situational).

---

## 2. Tool Context

An AI invoice/data‑entry processor for Indian small businesses (₹, GST). A vision model extracts vendor/date/number/line‑items/subtotal/tax/total from uploaded or Gmail‑pulled invoices, auto‑categorises to a chart of accounts, builds a **P&L bottom‑up** (revenue from sent invoices, expenses from received bills, **net of GST**), and shows **GST payable = output − input**. **Current baseline:** GST is one extracted `tax` number per invoice (no rate, no CGST/SGST/IGST split, no inclusive/exclusive logic, no RCM, no exempt tracking); income tax is an empty manual "Tax Expense" line; nothing else is handled.

---

## 3. GST Mechanics (the rules)

### 3.1 Registration thresholds (as of FY 2025‑26 — verify)

| Supply type | Normal states | Special‑category states |
|---|---|---|
| Goods | ₹40 lakh aggregate turnover | ₹20 lakh |
| Services | ₹20 lakh | ₹10 lakh |

J&K and Assam (otherwise special‑category) opted into the ₹40 lakh goods limit. Below threshold, registration is **optional** (but voluntary registration is common to claim ITC / sell B2B). ([ClearTax — GST registration limits](https://cleartax.in/s/gst-registration-limits-increased), [Razorpay — registration limits](https://razorpay.com/learn/gst-registration-limits/))

**Product implication:** the tool must know **whether the user is registered**. An unregistered seller charges no GST at all — so "no GST on the invoice" is *correct*, not an error.

### 3.2 Composition scheme

A simplified flat‑rate scheme for small taxpayers. Turnover limit: **₹1.5 crore** (goods), **₹50 lakh** (services / mixed). Composition dealers **cannot charge GST on the invoice, cannot claim ITC**, and pay a flat % of turnover instead. Invoices say *"composition taxable person, not eligible to collect tax."* Indicative rates: **1%** traders/manufacturers, **5%** restaurants, **6%** service providers. Quarterly **CMP‑08**. ([ClearTax registration limits](https://cleartax.in/s/gst-registration-limits-increased), [Vyapar](https://vyaparapp.in/))

**Product implication:** composition users should have GST‑payable computed as *flat % of sales*, not output−input. A distinct mode.

### 3.3 Output tax, input tax, ITC, and net payable

- **Output tax** = GST charged on your **sales** (a liability you owe the govt).
- **Input tax** = GST paid on your **purchases**; claimable as **Input Tax Credit (ITC)** if the supply is for business and not in the blocked‑credit list (Sec 17(5)).
- **Net GST payable = Output tax − ITC**, settled monthly/quarterly (cash) via **GSTR‑3B**. ([CBIC RCM flyer / GSTR‑3B structure](https://gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/Reverse%20charge%20Mechanism.pdf), [Oracle JD Edwards GSTR‑3B 3.1 reference](https://docs.oracle.com/en/applications/jd-edwards/localizations/9.2/eoaid/gstr-3b-section-3-1.html))

This is exactly the dashboard figure the tool already computes — the math is right; only the *bookkeeping placement* needs fixing (see §4).

### 3.4 GST slabs — **GST 2.0, effective 22 Sep 2025** (verify; this is recent)

The 56th GST Council (3 Sep 2025) **collapsed the old 0/5/12/18/28 structure** into a two‑rate system plus a sin/luxury rate. Most 12% items moved to 5%; most 28% items moved to 18%.

| Slab | Role | Typical items |
|---|---|---|
| **0% (Nil)** | Essentials | UHT milk, paneer, Indian breads, many life‑saving drugs, books, fresh produce |
| **5%** (merit) | Mass‑use goods/services | Packaged food, toothpaste/soap, footwear/apparel (lower band), most everyday services formerly 12% |
| **18%** (standard) | **Default for most goods & services** | Most services, electronics, software/SaaS, professional fees, compact cars |
| **40%** (sin/luxury) | Demerit | Tobacco, pan masala, aerated drinks, premium cars (replaces old 28%+cess) |
| Niche | Special | Gold/precious metals **3%**, rough diamonds **0.25%** |

([ClearTax GST rates 2026](https://cleartax.in/s/gst-rates), [Cashfree — new GST rates](https://www.cashfree.com/blog/new-gst-rates/), [Tally — 12%/28% slabs axed](https://tallysolutions.com/gst/major-gst-shakeup-12-and-28-slabs-axing/))

> **Rec:** default the tool's "standard rate" to **18%** and let users pick 5%/18%/40%/0%/3%. Don't hard‑code the old 12%/28%. Keep a small editable rate table so the next Budget doesn't break you.

### 3.5 GST‑inclusive vs GST‑exclusive (the formula you need)

- **Exclusive** (tax added on top — typical B2B tax invoice): `GST = Base × rate%`; `Total = Base + GST`.
- **Inclusive** (price already contains tax — common B2C/retail/MRP): back it out:

  ```
  Taxable Value (Base) = Total × 100 / (100 + rate)
  GST                  = Total − Base
  ```
  e.g. ₹1,180 inclusive @18% → Base = 1180×100/118 = ₹1,000; GST = ₹180.

([India GST calculator — inclusive/exclusive & CGST/SGST/IGST](https://indiagraphs.com/tools/gst-calculator-india/), [TheGSTCalculator](https://thegstcalculator.in/), [TaxAdda GST calculator](https://calculator.taxadda.com/gst-calculator))

**Why it matters for the tool:** when an invoice total has no separate GST line, the right move depends on whether the price is inclusive (back it out) or the supply is exempt (₹0). Today the tool always assumes ₹0 → **under‑reports GST**.

### 3.6 CGST/SGST vs IGST (place of supply)

| Transaction | Tax | Split |
|---|---|---|
| **Intra‑state** (supplier & place of supply same state) | CGST + SGST | each = half the rate (18% → 9% + 9%) |
| **Inter‑state** (different states/UTs, or import/export) | IGST | full rate (18% → 18% IGST) |

CGST → central govt, SGST → state govt, IGST → central (later apportioned). The **total tax is identical**; only the split differs. ([India GST calculator](https://indiagraphs.com/tools/gst-calculator-india/), [Wise GST calculator](https://wise.com/in/vat/gst/calculator))

**Do small‑business tools track this?** Yes — Zoho, Tally, Vyapar, QuickBooks all auto‑split CGST/SGST vs IGST from the customer's state vs your state. It's required for GSTR‑1. **Rec:** capture *place of supply* (state) and derive the split; don't ask the user to choose CGST vs IGST manually.

### 3.7 Exempt / nil‑rated / zero‑rated / non‑GST

| Type | Meaning | GST charged | ITC on inputs |
|---|---|---|---|
| **Nil‑rated** | Taxable but rate is 0% (e.g. some grains) | ₹0 | No |
| **Exempt** | Notified exempt (e.g. certain services, unbranded food) | ₹0 | No |
| **Zero‑rated** | **Exports & SEZ supplies** | ₹0 (with LUT) or IGST paid then refunded | **Yes — refundable** |
| **Non‑GST** | Outside GST (petrol, alcohol) | N/A | No |

In GSTR‑3B these go to distinct boxes: 3.1(a) taxable, **3.1(b) zero‑rated**, **3.1(c) nil‑rated/exempt**. Critically, **zero‑rated ≠ exempt**: exporters keep their ITC, exempt suppliers don't. ([RCM/zero‑rated guide](https://cleartaxadvisors.in/rcm-reverse-charge-mechanism-under-gst/), [Oracle GSTR‑3B 3.1](https://docs.oracle.com/en/applications/jd-edwards/localizations/9.2/eoaid/gstr-3b-section-3-1.html))

**Product implication:** a "GST = 0" invoice could be *any* of these. The tool needs an explicit tag, because they're reported in different return boxes and have different ITC consequences.

### 3.8 Reverse Charge Mechanism (RCM)

Normally the **seller** collects GST. Under **RCM the buyer** self‑assesses and pays GST directly to the govt (then usually claims it back as ITC). Common triggers: goods transport (GTA), legal services, imports of services, purchases from unregistered dealers (notified cases). The supplier's invoice shows **no GST**, but the **buyer still owes it**. RCM applies *only* where there's a taxable charge — never on exempt/nil/non‑taxable supplies. ([ClearTax RCM guide](https://cleartaxadvisors.in/rcm-reverse-charge-mechanism-under-gst/), [Tally RCM](https://tallysolutions.com/gst/reverse-charge-mechanism-in-gst/), [CBIC RCM flyer](https://gstcouncil.gov.in/sites/default/files/e-version-gst-flyers/Reverse%20charge%20Mechanism.pdf))

**Product implication:** another reason a "no‑GST" purchase bill is *not* ₹0 liability — under RCM the user owes GST the invoice never showed. Needs an **RCM flag** on bills.

---

## 4. GST in Bookkeeping & the P&L

**GST is a balance‑sheet pass‑through, not a P&L item.** You are a collection agent for the government:

- **On a sale:** book **revenue net of output GST**; the GST sits in an **Output GST / GST Payable (liability)** account.
- **On a purchase:** book **expense/asset net of input GST**; the recoverable GST sits in an **Input GST / ITC (asset)** account.
- **At period end:** Output liability − Input asset = **net GST payable** (a current liability), discharged in cash. None of these touch the P&L.

This is the treatment in ICAI's *Handbook on Finalisation of Accounts with GST perspective* (review of Balance Sheet vs Statement of P&L). ([ICAI Handbook](https://idtc-icai.s3.ap-southeast-1.amazonaws.com/download/pdf20/Handbook-on-Finalisation-of-Accounts-with-GST-perspective-23-12-2020.pdf), [ICAI IDTC publications](https://idtc.icai.org/publications.php))

**Where the current tool is right and wrong:** the *dashboard* GST‑payable figure (output − input) is correct. But because the P&L is built "bottom‑up from invoices," the tool must ensure it books the **net‑of‑GST** amount on each line and routes the tax to liability/asset accounts — *not* into revenue/expense, and *never* as a P&L "GST expense." The brief says expenses are already booked net of GST; the fix is to make GST a tracked liability/asset rather than a discarded number, so the payable figure is auditable.

---

## 5. The "No GST on a Sale" Problem

When a **sales** invoice shows a total but no GST line, there are **three interpretations**. The tool currently assumes #3‑as‑zero and under‑reports.

| # | Interpretation | When it's the right read | Correct handling |
|---|---|---|---|
| **A. GST‑inclusive** | Price already includes GST (B2C/retail/MRP, or a sloppy B2B bill) | Seller **is GST‑registered**, supply **is taxable**, total looks "round" or is a consumer sale | **Back out GST:** `Base = Total×100/(100+rate)`, `GST = Total − Base`. Book base as revenue, GST as output liability. |
| **B. Genuinely exempt / nil / unregistered / composition** | No GST legally due | Supply is exempt/nil‑rated; **or** seller is unregistered/composition | Book **₹0 GST**, full total = revenue. Tag the supply as exempt/nil so it lands in the right return box. |
| **C. Omitted / data error** | GST should be there but wasn't itemised or extracted | Registered seller, taxable supply, B2B context | **Flag for human.** Don't guess silently. |

> **Rec — default behaviour:**
> 1. If user is **unregistered or composition** → ₹0 GST, no flag (correct by law).
> 2. If user is **registered** and supply is **taxable** and no GST line → **assume GST‑inclusive at the standard rate (18%) and raise an amber flag**, with one‑click resolutions: *"Inclusive @ 18%" / "Exempt/Nil" / "Zero‑rated export" / "Enter rate."* Inclusive is the safest default because it **never under‑reports** — booking ₹0 does.
> 3. Only book a true ₹0 when the user explicitly tags the line **Exempt/Nil/Zero‑rated**.
>
> The principle: **GST liability depends on whether the supply is taxable, not on whether the invoice itemised tax.** Bias the default toward "tax is owed, confirm it" rather than "no line, so zero."

---

## 6. Direct Tax & the P&L Tax Line

Income/corporate tax is **not** part of operating results — it appears as a **"Provision for Tax" (current tax)** line **below** profit‑before‑tax, and it's an **estimate** until the return is filed (and finalised after advance‑tax/TDS adjustments).

### 6.1 Effective rates by entity (FY 2025‑26 / AY 2026‑27 — verify each Budget)

| Entity | Headline rate | Surcharge | Cess | Effective (approx.) | Notes |
|---|---|---|---|---|---|
| **Proprietor / individual (new regime, default)** | Slabs 0→30% | 10–25% (high income) | 4% | marginal; ~0% up to ₹12L income (rebate) | Slabs: 0–4L nil, 4–8L 5%, 8–12L 10%, 12–16L 15%, 16–20L 20%, 20–24L 25%, >24L 30%. ([ClearTax slabs](https://cleartax.in/s/income-tax-slabs)) |
| **Partnership firm / LLP** | **30% flat** | 12% if income >₹1 cr | 4% | **~31.2%**, up to **~34.94%** with surcharge | No slab benefit. ([Bajaj — firm slab](https://www.bajajfinserv.in/income-tax-slab-partnership-firm)) |
| **Domestic company — normal** | 30% | 7% (>₹1cr) / 12% (>₹10cr) | 4% | ~31.2–34.94% | ([PwC — corporate income](https://taxsummaries.pwc.com/india/corporate/taxes-on-corporate-income)) |
| **Domestic company — turnover ≤ ₹400 cr** | **25%** | 7%/12% | 4% | ~26–29% | Most SMEs. |
| **Company — Sec 115BAA (concessional)** | **22%** | 10% | 4% | **25.17%** | No incentives; MAT‑exempt. ([ClearTax 115BAA](https://cleartax.in/s/section-115-baa-tax-rate-domestic-companies)) |
| **Company — Sec 115BAB (new mfg)** | **15%** | 10% | 4% | **~17.16%** | New manufacturers, conditions/dates apply. ([Bajaj 115BAB](https://www.bajajfinserv.in/investments/section-115bab-of-income-tax-act)) |

*(Individual new‑regime: standard deduction ₹75,000; rebate makes income up to ₹12L effectively tax‑free. Old regime still optional. — [ClearTax](https://cleartax.in/s/income-tax-slabs))*

### 6.2 Presumptive taxation (simpler estimate for tiny businesses)

| Section | Who | Turnover limit (FY 25‑26) | Presumed profit |
|---|---|---|---|
| **44AD** | Resident individual/HUF/firm (not LLP), eligible businesses | ₹2 cr (₹3 cr if ≥95% digital receipts) | **8%** of turnover (**6%** on digital) |
| **44ADA** | Resident professionals (CA, legal, medical, etc.) | ₹50 L (₹75 L if ≤5% cash) | **50%** of gross receipts |
| **44AE** | Goods‑carriage operators (≤10 vehicles) | per‑vehicle | fixed ₹ per vehicle/month |

File via **ITR‑4 (Sugam)**. ([ClearTax 44AD](https://cleartax.in/s/section-44ad-presumptive-scheme), [ClearTax 44ADA](https://cleartax.in/s/section-44ada), [Tax2win 44AD/ADA/AE](https://tax2win.in/guide/section-44ad-44ada-44ae))

### 6.3 Advance tax & TDS (as they touch the books)

- **Advance tax:** if annual tax liability > ₹10,000, pay in 4 instalments (15 Jun/Sep/Dec, 15 Mar). Affects cash, not the P&L expense. Shown as an *asset* (advance tax paid) until set off against the provision.
- **TDS:** tax deducted at source on certain payments (e.g. **194J** professional fees 10%, technical 2%; threshold ₹50,000/yr). When *you deduct* on a vendor bill → **TDS payable (liability)**; when *a customer deducts* on your invoice → **TDS receivable (asset)**, set off against your final tax. ([ClearTax 194J](https://cleartax.in/s/section-194j))

> **Rec for the P&L tax line:** show **"Provision for Tax (estimated)"** = `applicable rate × net profit`, picked from an entity‑type setting, clearly labelled *"estimate — final on filing."* Offer a presumptive toggle. Don't model surcharge bands, MAT, or set‑offs in v1.

---

## 7. Other Levies (treat as ordinary operating expenses)

| Levy | What | Treatment |
|---|---|---|
| **Professional tax** | State tax on trades/employment (≤₹2,500/yr) | Operating expense (and a payroll deduction if employees) |
| **Property tax** | Municipal tax on owned premises | Operating expense |
| **Stamp duty** | On agreements/property/share transfers | Expense, or capitalised if on a capital asset |
| **Trade licence / shop‑establishment fee** | Municipal licence | Operating expense |
| **Customs duty** | On imports | Capitalised into cost of goods (import IGST is separate, ITC‑claimable) |

None of these need a special tier — a normal expense category line is enough. ([PwC — other taxes](https://taxsummaries.pwc.com/india/corporate/other-taxes))

---

## 8. Competitive Teardown — how others handle GST & tax

| Tool | Registration / GST setup | Inclusive/exclusive toggle | CGST/SGST/IGST | Missing/zero GST handling | GST in P&L or BS | GST returns surfaced | Income‑tax line |
|---|---|---|---|---|---|---|---|
| **Zoho Books** (India‑native) | GSTIN + **per‑customer/vendor GST treatment**: Registered / Composition / Unregistered / Consumer / **SEZ** / Overseas / Deemed Export — drives B2B vs B2C vs export reporting | Yes, per line/transaction | Auto‑split from party state vs yours | Treatment field forces an explicit category (you can't leave a B2B sale untyped) | Balance‑sheet pass‑through (tax liability/ITC accounts) | **GSTR‑1/2/3B, GSTR‑9** auto‑generated | No tax‑provision automation (accounting tool, not ITR) |
| **Tally Prime** (India‑native) | Registration type (Regular/Composition/Unregistered); GST at company/group/item/ledger levels | Yes (incl. inclusive‑of‑tax stock items) | Auto CGST/SGST/IGST by transaction type | Item‑level rate config; reconciliation reports flag mismatches | Balance‑sheet pass‑through | **GSTR‑1, GSTR‑3B** ready for portal upload | No |
| **Vyapar** (India‑native, SMB/mobile) | Simple registration toggle; **per‑item rate auto‑detected** | Yes (inclusive/exclusive on bills) | Auto by intra/inter‑state | Rate sits on the item, so a blank tax is rare | Balance‑sheet | Auto **GSTR‑1/2/3B/4/9**, one‑click send to CA | No |
| **ClearTax** (India‑native, compliance‑first) | GSTIN‑centric; multi‑GSTIN at PAN level | At invoice creation | Yes | **Advanced reconciliation** vs GSTR‑2A/2B for ITC (auto‑match) | Compliance layer, not full ledger | GSTR‑1/2A/3B, **ITC maximisation** | Separate ITR products |
| **myBillBook** (India‑native, SMB) | GST/non‑GST invoice choice; tax rate in settings | Yes | Auto | Can issue **non‑GST** invoices explicitly | Reports layer | GSTR reports + **CA portal** access | No |
| **Marg ERP** (India‑native, retail/pharma) | Registration setup; bulk GST‑rate update via GST menu | Yes | Auto | Item‑master driven | Balance‑sheet | GSTR‑1/3B | No |
| **RazorpayX Books** | Payments‑led; books layer for reconciliation | Inherits from invoice | Auto | Reconciliation‑oriented | Balance‑sheet | GST payment + reports | No |
| **QuickBooks Online** (global) | **Exited India 30 Apr 2023** — no longer sold/serviced in India | Yes — **line‑level Inclusive / Exclusive / Not applicable** tax model | Yes (where supported) | Tax code per line; can be "Not applicable" | Balance‑sheet (GST liability account) | GSTR‑1‑6 export report | No (accounting only) |
| **Xero** (global, India GST support) | **Org‑wide registration status**; default tax treatment for sales & purchases | **Default Tax Exclusive / Tax Inclusive** setting, overridable per transaction | Yes | Per‑transaction tax treatment must be chosen | Balance‑sheet; **cash vs accrual** GST method | GST return shows owed/owing | No |
| **FreshBooks / Wave** (global, light) | Simple tax‑rate setup; **not India‑GST‑specialised** | Yes (add tax to line) | Generic tax, not CGST/SGST split | Manual | Balance‑sheet | Generic tax summary, **no GSTR** | No |

**Copyable UX patterns worth mirroring:**
- **Zoho's per‑party "GST treatment" dropdown** (Registered / Composition / Unregistered / Consumer / SEZ / Overseas / Deemed Export) — this single field resolves inclusive/exclusive, CGST/SGST‑vs‑IGST, and the return box in one choice. **Best single pattern to copy.** ([Zoho](https://www.zoho.com/in/books/kb/gst/gst-import-format.html))
- **Xero's org‑level "Tax Inclusive/Exclusive default" + per‑transaction override**, plus a **cash vs accrual GST method** switch. ([Xero — how GST works](https://central.xero.com/s/article/How-GST-works-in-Xero), [Xero tax treatment](https://central.xero.com/s/article/Choose-the-right-tax-treatment-on-transactions-SG))
- **QuickBooks' line‑level Inclusive / Exclusive / Not‑applicable** tax model. ([Intuit — GST calculation](https://quickbooks.intuit.com/learn-support/en-sg/help-article/sales-taxes/learn-quickbooks-online-calculates-gst/L8VWCLobK_SG_en_SG))
- **Vyapar/Tally's rate‑on‑the‑item** so tax is rarely blank. ([Vyapar](https://vyaparapp.in/))
- **ClearTax's GSTR‑2A/2B reconciliation** for *input‑tax accuracy* — relevant because the tool's GST‑payable depends on correct ITC. ([ClearTax reconciliation](https://cleartax.in/s/gst-reconciliation-software/))
- **myBillBook / Vyapar "CA portal"** — export GSTR summaries to the user's accountant rather than filing yourself. Lower‑risk than auto‑filing. ([myBillBook](https://mybillbook.in/))

*Note: QuickBooks' India exit (Apr 2023) leaves a gap in the affordable‑English‑UX segment that Zoho largely filled — useful positioning context. ([Intuit — discontinuation of QuickBooks in India](https://blogs.intuit.com/2023/03/22/discontinuation-of-quickbooks-in-india/))*

---

## 9. Missing‑Tax Gap Analysis (exhaustive)

Every tax/levy a typical Indian small business tracks, vs. the tool's current baseline (single `tax` number + empty income‑tax line).

| Tax / levy | What it is | Mandatory or situational | Where it belongs in the app | Priority |
|---|---|---|---|---|
| **GST rate per line** | The %, (5/18/40/0/3) behind each tax amount | Mandatory (registered) | Extracted field on each line item | **Must‑have** |
| **CGST/SGST vs IGST split** | Intra‑ vs inter‑state allocation of GST | Mandatory | Derived from place‑of‑supply (state) → 3 sub‑accounts | **Must‑have** |
| **GST‑inclusive handling** | Backing tax out of an inclusive total | Mandatory (common B2C) | Per‑invoice inclusive/exclusive flag + formula | **Must‑have** |
| **Exempt / nil‑rated tagging** | Supplies with no GST due | Situational | Per‑line supply‑type tag → correct ₹0 + return box | **Must‑have** |
| **Zero‑rated (exports/SEZ)** | ₹0 GST but **ITC retained/refundable** | Situational (exporters) | Per‑invoice "zero‑rated" tag; separate from exempt | **Must‑have** if any export users; else nice‑to‑have |
| **Reverse Charge (RCM)** | Buyer owes GST seller didn't charge | Situational (GTA, legal, imports, unregistered buys) | RCM flag on **bills** → creates output liability + ITC | **Must‑have** (correctness; avoids hidden liability) |
| **GST payable as balance‑sheet liability** | Output−input parked as a liability/asset, not P&L | Mandatory | Liability (output) + asset (ITC) accounts; payable = net | **Must‑have** (already computed; needs proper placing) |
| **Registration / composition status** | Whether & how the user charges GST | Mandatory | Company‑level setting (GSTIN, regular/composition/unregistered) | **Must‑have** |
| **Composition‑scheme tax** | Flat % of turnover, no ITC | Situational | Alt GST mode (flat % of sales) | Nice‑to‑have |
| **Income‑tax provision (estimate)** | Current‑tax estimate by entity type | Mandatory (every business) | Single P&L "Provision for Tax (est.)" below PBT | **Must‑have** |
| **Presumptive (44AD/44ADA/AE)** | Simplified profit‑based tax for small biz | Situational | Alternate income‑tax estimate toggle | Nice‑to‑have |
| **TDS payable (you deduct)** | Tax withheld on vendor payments | Situational (above audit/threshold) | Balance‑sheet liability; flag on bills (e.g. 194J) | Nice‑to‑have |
| **TDS receivable (deducted from you)** | Tax customers withheld on your invoices | Situational (B2B services) | Balance‑sheet asset; set off vs tax provision | Nice‑to‑have |
| **TCS (tax collected at source)** | Collected on certain sales / by e‑commerce | Situational | Liability sub‑account | Skip v1 |
| **Advance tax** | Quarterly pre‑payment of income tax | Situational (>₹10k liability) | Asset (advance tax paid); reminder/cash‑flow note | Nice‑to‑have |
| **Professional tax** | State trade/employment tax | Situational (most states) | Operating‑expense line | Nice‑to‑have |
| **Cess / surcharge** | On high incomes (4% cess always; surcharge bands) | Situational | Inside the income‑tax estimate, not separate | Nice‑to‑have |
| **Capital gains** | Tax on asset/investment disposals | Situational (rare for SMB ops) | Out of scope / separate report | Skip v1 |
| **Customs / import IGST** | Duty + IGST on imports | Situational (importers) | Bill detail; IGST → ITC; duty → cost | Skip v1 (situational) |
| **GST cess on sin goods** | Compensation/40‑slab extras | Situational (tobacco, etc.) | Rate table | Skip unless relevant |
| **GSTR‑1 / 3B summary export** | Return‑ready output | Mandatory eventually | Separate report from the ledger | Nice‑to‑have (high value) |

---

## 10. Best‑Practice Patterns & Specific Recommendations

1. **Company GST setting (onboarding):** "Are you GST‑registered?" → GSTIN, and **registration type** (Regular / Composition / Unregistered). This alone resolves most "no‑GST" ambiguity. Copy **Zoho/Tally**.
2. **Per‑customer/vendor GST treatment** dropdown: Registered / Composition / Unregistered / Consumer / SEZ / Overseas. **Directly copy Zoho.** Drives inclusive/exclusive, CGST‑SGST‑vs‑IGST, and the return box automatically. ([Zoho](https://www.zoho.com/in/books/kb/gst/gst-import-format.html))
3. **Per‑invoice/line flags:** **GST‑exclusive / GST‑inclusive / Exempt‑Nil / Zero‑rated / RCM**, plus a **rate** field (default 18%). Back out inclusive tax with `Base = Total×100/(100+rate)`. Copy **Xero's default‑with‑override** model. ([Xero](https://central.xero.com/s/article/How-GST-works-in-Xero))
4. **Default for a registered, taxable sale with no GST line → assume inclusive @ standard rate + amber flag**, never silent ₹0 (§5). This is the core correctness fix.
5. **GST on the balance sheet:** output‑GST liability + input‑GST(ITC) asset; dashboard "GST payable = output − input" stays. **Never** a P&L GST expense. ([ICAI Handbook](https://idtc-icai.s3.ap-southeast-1.amazonaws.com/download/pdf20/Handbook-on-Finalisation-of-Accounts-with-GST-perspective-23-12-2020.pdf))
6. **Income‑tax line = one "Provision for Tax (estimated)"** below PBT, driven by an entity‑type setting (proprietor slabs / firm‑LLP 31.2% / company 25.17% via 115BAA / 25% / 30%). Label "estimate." Offer a **presumptive** toggle. Don't build surcharge/MAT logic in v1.
7. **Editable rate table** (GST slabs + entity tax rates), dated, so a Budget/Council change is a config edit, not a code change. **Show "as of FY 2025‑26" in‑product.**
8. **Reconciliation hook (later):** mirror ClearTax — compare extracted input GST against GSTR‑2B to validate ITC before trusting the payable figure. ([ClearTax](https://cleartax.in/s/gst-reconciliation-software/))
9. **CA‑portal export** of GSTR‑1/3B summaries (copy Vyapar/myBillBook) rather than auto‑filing — lower compliance risk for a v1. ([Vyapar](https://vyaparapp.in/), [myBillBook](https://mybillbook.in/))

---

## 11. Open Questions / Product Decisions

1. **Auto‑file vs export‑to‑CA?** Generating GSTR‑1/3B summaries for a CA is far lower‑risk than filing on the portal. Recommend export‑first.
2. **How aggressive is the inclusive‑GST default?** Auto‑backing‑out at 18% maximises GST captured but can be wrong for genuinely exempt sellers — gate it behind the registration setting + confirmation.
3. **Do target users export / sell to SEZ?** Determines whether zero‑rated handling is must‑have or deferrable.
4. **TDS scope.** Many small businesses *receive* TDS (receivable) even when not deducting. Worth a light asset‑tracking feature? Decide based on user mix (services vs goods).
5. **Entity‑type capture.** Income‑tax estimate needs proprietor vs firm vs company. Ask at onboarding, or infer from GSTIN PAN's 4th character (P=individual, F=firm, C=company, etc.)?
6. **Composition users** need a different GST model (flat % of turnover, no ITC). Separate mode or out of scope for v1?
7. **Rate maintenance ownership.** Who updates the rate table after each Budget/GST Council meeting — manual ops, or a fetched config?
8. **Place‑of‑supply accuracy.** CGST/SGST‑vs‑IGST depends on the customer's state; can the vision model reliably extract state / GSTIN, or do you ask the user once per customer?

---

*Compiled June 2026. All rate‑sensitive facts dated to FY/AY 2025‑26 and GST 2.0 (effective 22 Sep 2025); GST Council and Union Budget change these — re‑verify against CBIC ([cbic-gst.gov.in](https://cbic-gst.gov.in)), the GST portal, and the Income Tax Department ([incometax.gov.in](https://www.incometax.gov.in)) before relying on any number in production.*
