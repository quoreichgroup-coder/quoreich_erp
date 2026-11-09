"""Connected, read-only CFO regression. Run with python3; requires a managed test session.

CSV downloads and screenshots stay in /tmp/browser/cfo-live, never in the checkout.
"""
import asyncio
import csv
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright

OUTPUT = Path("/tmp/browser/cfo-live")


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if os.environ.get("LOVABLE_BROWSER_AUTH_STATUS") == "injected":
        key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
        session = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
        cookies = json.loads(os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON") or "[]")
    else:
        with open(Path.home() / ".cache/lovable-auth/session.json") as file:
            minted = json.load(file)
        key, session = minted["storage_key"], json.dumps(minted["session"])
        cookies = minted.get("cookies") or []

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        if cookies:
            await context.add_cookies([{**c, "url": "http://localhost:8080"} for c in cookies])
        page = await context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.goto("http://localhost:8080")
        await page.evaluate("([k,v]) => localStorage.setItem(k,v)", [key, session])
        async with page.expect_response(lambda response: response.url.endswith("/rpc/get_consolidated_cfo_kpis")) as pending:
            await page.goto("http://localhost:8080/cockpit/consolidated")
        response = await pending.value
        assert response.status == 200, "KPI request failed"
        actual = await response.json()
        assert actual, "This test needs an account with at least one accessible company"
        allowed = [row["tenant_id"] for row in actual]
        trigger = page.get_by_test_id("kpi-header-cash_on_hand")
        await trigger.wait_for()

        # Request an impossible extra tenant with the same authenticated request.
        # Authorization remains server-side; no local role or tenant manipulation.
        headers = {name: value for name, value in (await response.request.all_headers()).items()
                   if not name.startswith(":") and name not in {"content-length", "host"}}
        probe = await context.request.post(response.url, headers=headers, data={
            "_tenant_ids": allowed + ["00000000-0000-0000-0000-000000000000"],
        })
        assert probe.status == 200
        assert {row["tenant_id"] for row in await probe.json()} == set(allowed)
        empty = await context.request.post(response.url, headers=headers, data={
            "_tenant_ids": ["00000000-0000-0000-0000-000000000000"],
        })
        assert empty.status == 200 and await empty.json() == []

        for months in [3, 6, 12]:
            await page.get_by_role("button", name=f"{months} mois", exact=True).click()
            await page.wait_for_function("() => ![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'CSV').disabled")
            async with page.expect_download() as pending_download:
                await page.get_by_role("button", name="CSV", exact=True).click()
            download = await pending_download.value
            path = OUTPUT / f"export-{months}.csv"
            await download.save_as(path)
            with open(path, encoding="utf-8-sig") as file:
                rows = list(csv.DictReader(file))
            points = [row for row in rows if row["Type de données"] == "Tendance consolidée"]
            companies = [row for row in rows if row["Type de données"] == "KPI par société"]
            assert len(points) == months
            assert {row["Société"] for row in companies} == {row["tenant_name"] for row in actual}
            assert all(row["Période (mois)"] == str(months) for row in rows)
            assert all(column in points[0] for column in ["Total Revenue", "Total Expenses", "Net Profit", "Cash Balance"])

        for activation in ["Enter", "Space"]:
            await trigger.focus()
            await page.keyboard.press(activation)
            dialog = page.get_by_role("dialog")
            await dialog.wait_for()
            assert await dialog.get_attribute("aria-modal") == "true"
            for attribute in ["aria-labelledby", "aria-describedby"]:
                identifier = await dialog.get_attribute(attribute)
                assert identifier and await page.locator(f'[id="{identifier}"]').count() == 1
            for movement in ["Tab", "Shift+Tab"] * 3:
                await page.keyboard.press(movement)
                assert await dialog.evaluate("el => el.contains(document.activeElement)")
            await dialog.screenshot(path=str(OUTPUT / f"modal-{activation}.png"))
            await page.keyboard.press("Escape")
            await dialog.wait_for(state="hidden")
            assert await trigger.evaluate("el => el === document.activeElement")

        # Fully deselect: no silent auto-reselection or cached-scope export.
        for checkbox in await page.get_by_role("checkbox").all():
            await checkbox.uncheck()
        await page.get_by_text("Sélectionnez au moins une société.", exact=True).first.wait_for()
        assert await page.get_by_role("button", name="CSV", exact=True).is_disabled()
        assert not errors, "Unexpected runtime errors"
        await page.screenshot(path=str(OUTPUT / "empty-selection.png"))
        print("PASS: authenticated KPI loading, server tenant scoping, CSV 3/6/12, modal keyboard/ARIA, empty selection")
        await browser.close()


asyncio.run(main())