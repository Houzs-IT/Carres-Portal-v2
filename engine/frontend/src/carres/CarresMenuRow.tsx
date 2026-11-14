// Carres only (not part of Houzs's code): the way from Houzs's phone app back to the Carres pages.
//
// On a phone the portal steps aside and Houzs's phone app fills the screen (embed.ts carresPhone), so the Carres
// rows (Workspace, Leave, Subscription, Finance, Admin) are reached through this one row at the foot of Houzs's
// Menu sheet: it opens the portal's own menu over the app. Drawn with the sheet's own classes (mobile.css), so it
// looks like every other Menu row.
import { CARRES_EMBEDDED, openCarresPortalMenu } from "./embed";

export function CarresMenuRow({ onOpen }: { onOpen: () => void }) {
  if (!CARRES_EMBEDDED) return null;
  return (
    <div className="mgroup">
      <div className="mgh"><span className="gl">Carres</span></div>
      <div className="mgrid">
        <button className="mcard" onClick={() => { onOpen(); openCarresPortalMenu(); }}>
          <span className="ml">Carres menu</span>
        </button>
      </div>
    </div>
  );
}
