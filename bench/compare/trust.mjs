import { connect } from "./cdp.mjs";
const c = await connect();
for (let i = 0; i < 20; i++) {
	const done = await c.evaluate(`if (typeof app === "undefined" || !app.workspace) return "";
	  
	  const b = [...document.querySelectorAll(".mod-trust-folder button")].find((b) => !b.classList.contains("mod-cancel"));
	  if (b) { window.__enableAt = performance.now(); b.click(); return "trusted"; }
	  return app.workspace.layoutReady && document.querySelector(".workspace") ? "none" : "";`);
	if (done) {
		console.log(done);
		break;
	}
	await c.sleep(500);
}
c.close();
