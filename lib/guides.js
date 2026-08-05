// Interactive step-by-step guides for common workflows.
//
// The original version advanced on *any* reply and matched its alternate paths
// with `response.includes("not enough RE")` — literal phrases nobody types, so
// every alternate branch was unreachable and "wait, what?" marched the user to
// the next step. Progression is now model-checked: the reply is classified as
// advancing, stuck (with which alternate), off-topic, or done.
const { config } = require("./config");
// Module object rather than a destructured `complete`, so tests can stub it —
// destructuring binds at load time. Same reason lib/learn.js holds it this way.
const llm = require("./llm");
// Module object rather than destructured — same stubbing reason as the note
// on lib/respond.js's `answer` import.
const answer = require("./answer");
const { looksLikeHelpRequest } = require("./intent");
const db = require("./db");
const log = require("./log");

const MAX_TOKENS = 20;
const TIMEOUT_MS = 10000;

// Real headroom for a real answer — an install command, a specific fix — not
// the 20-token classifier budget above.
const STUCK_ANSWER_MAX_TOKENS = 400;

const ADVANCE = "ADVANCE";
const STUCK = "STUCK";
const OTHER = "OTHER";
const DONE = "DONE";

// Typed anywhere in a guide thread, bails out immediately. Checked before the
// model call so quitting is always free and always works.
const EXIT_PATTERN = /^\s*(?:stop|quit|exit|cancel|nvm|nevermind|never mind|forget it|no thanks|nah im good|nah i'm good)\b/i;

const GUIDES = {
  "create-hackpad": {
    name: "How to Build Your Own Hackpad (Macropad)",
    steps: [
      {
        message: "yooo let's build u a macropad! :yay: (this walkthrough's adapted from Hack Club's hackpad program, hackpad.hackclub.com — full credit to them for the original guide) this is a whole project — PCB design, then a case, then firmware — but we'll go through it one step at a time. first, grab the KiCad care package from the hackpad resources page (https://hackpad.hackclub.com/resources), unzip `kicad_care_package.zip`, and install the `.sym`/`.pretty` libraries into KiCad (search youtube if u get stuck on the install itself)",
        checkNext: "got the library installed in KiCad? (yes/no)",
        screenshot: "create-hackpad/01.webp",
      },
      {
        message: 'nice! now open KiCad, make a new project, and click the "Schematic Editor" button',
        checkNext: "schematic editor open? (yes/no)",
        screenshot: "create-hackpad/02.webp",
      },
      {
        message: "in the schematic editor, press A to open the add-component menu. search for and add: MODULE-SEEEDUINO-XIAO (that's the microcontroller) and SW_Push (the switch — add 3 of those, one per key)",
        checkNext: "got the XIAO and all 3 switches placed? (yes/no)",
        screenshot: "create-hackpad/03.webp",
      },
      {
        message: "now wire it up — press W to start a wire, and connect ur 3 switches to pins 11, 10, and 9 on the microcontroller. press P and search GND to grab a ground symbol for the other side of each switch",
        checkNext: "all wired up? (yes/no)",
        screenshot: "create-hackpad/04.webp",
      },
      {
        message: 'time to assign footprints (what actually gets drawn on the PCB) — click the "run footprint assignment tool" button in the top right',
        checkNext: "footprint assignment window open? (yes/no)",
        screenshot: "create-hackpad/05.webp",
      },
      {
        message: "assign each component the matching footprint (match the reference image), then hit apply and save the schematic — schematic's officially done! :yesyes:",
        checkNext: "footprints assigned and schematic saved? (yes/no)",
        screenshot: "create-hackpad/06.webp",
      },
      {
        message: 'head back to the KiCad project page and open the "PCB Editor", then hit "Update PCB from Schematic" in the top right to pull ur components in',
        checkNext: "components dumped onto the PCB view? (yes/no)",
        screenshot: "create-hackpad/07.webp",
      },
      {
        message: "right click the XIAO and hit \"flip side\" (this puts it on the bottom for soldering), then arrange all the components to match the layout",
        checkNext: "components flipped and arranged? (yes/no)",
        screenshot: "create-hackpad/08.webp",
      },
      {
        message: "now route it! press X and click any gold pad with a blue line — it'll dim the screen and show u where to go. route every connection (switch layer from F.Cu to B.Cu on the right to see the blue lines)",
        checkNext: "PCB fully routed? (yes/no)",
        screenshot: "create-hackpad/09.webp",
      },
      {
        message: "last PCB step — switch to the Edge.Cuts layer and draw a rectangle outlining ur board size (use the measure tool to check the dimensions). that's the PCB done!! onto the case :3c:",
        checkNext: "board outline drawn on Edge.Cuts? (yes/no)",
        screenshot: "create-hackpad/10.webp",
      },
      {
        message: "case time, in Fusion360 (free personal license). new sketch, draw a rectangle matching ur PCB's dimensions plus 0.4mm on each side for printing tolerance",
        checkNext: "PCB-sized sketch drawn? (yes/no)",
        screenshot: "create-hackpad/11.webp",
      },
      {
        message: "now draw a bigger rectangle around that one with a 10mm margin — this'll be the outer wall of the case",
        checkNext: "margin rectangle drawn? (yes/no)",
        screenshot: "create-hackpad/12.webp",
      },
      {
        message: "sketch in the mounting holes too (u'll use these to screw the case together later)",
        checkNext: "mounting holes sketched? (yes/no)",
        screenshot: "create-hackpad/13.webp",
      },
      {
        message: "extrude the base of the case by 3mm",
        checkNext: "base extruded? (yes/no)",
        screenshot: "create-hackpad/14.webp",
      },
      {
        message: "now extrude the outer walls by 10mm (13mm tall total) — that's the bottom half of the case done",
        checkNext: "walls extruded? (yes/no)",
        screenshot: "create-hackpad/15.webp",
      },
      {
        message: 'onto the plate — head to ai03\'s plate generator (https://kbplate.ai03.com/) and paste in `["","",""],` to generate a 3-key plate. download the DXF and import it into Fusion360, making sure it\'s centered',
        checkNext: "plate imported and centered? (yes/no)",
        screenshot: "create-hackpad/16.webp",
      },
      {
        message: "extrude the plate by 3mm",
        checkNext: "plate extruded? (yes/no)",
        screenshot: "create-hackpad/17.webp",
      },
      {
        message: "last case step — add a USB cutout so u can actually plug the thing in. congrats, case is done!! :yay:",
        checkNext: "USB cutout added? (yes/no)",
        screenshot: "create-hackpad/18.webp",
      },
      {
        message: "final stretch — firmware. this uses QMK (https://qmk.fm/) — check out the porting guide at https://docs.qmk.fm/porting_your_keyboard_to_qmk to get ur specific board flashed. once that's working u've got a fully working macropad from scratch :yesyes: don't forget to ship it as a project on Pixl (https://pixl.hackclub.com/projects/) when u're done!",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "stuck on a specific step and googling didn't help": "no worries — most of this you can google in like 2 seconds, but if you're properly stuck just drop what you're stuck on in #hackpad and someone'll help u out :hii:",
      "doesn't have kicad or fusion360 installed": "kicad's free! on linux: `sudo apt install kicad` (debian/ubuntu), `sudo dnf install kicad` (fedora), `sudo pacman -S kicad` (arch), or `flatpak install flathub org.kicad.KiCad` if ur distro's repo version is old/outdated. everywhere else just grab the installer from https://www.kicad.org/. fusion360 has a free personal-use license at https://www.autodesk.com/products/fusion-360/personal (that's what this guide uses — u can sub in other CAD software but it'll be harder to follow along)",
      "doesn't know where to get the physical parts": "check the approved parts list at https://hackpad.hackclub.com/parts — hack club covers the parts for free if u're a teenager building along with this",
      "wants to add more keys, a knob, leds, etc": "totally doable! check https://hackpad.hackclub.com/add-components for how to wire up extra stuff like that — for a full submission u'll wanna customize it beyond the 3-key example anyway",
      "ready to submit the finished macropad": "hell yeah — head to https://pixl.hackclub.com/projects/ and ship it as a project, same as any other build",
      "pcb has drc errors or red marks after routing": "those red marks mean the DRC (design rule checker) caught something — usually two traces sitting too close together or a net that's not fully connected yet. run Inspect > Design Rules Checker to see the exact list, click each violation to jump straight to it, and re-route or nudge just that spot. if it's a clearance issue, widen the gap slightly or shrink the trace width a touch in its properties",
      "fusion360 asks to sign in or activate a personal use license": "yeah fusion360 makes u create a free autodesk account and pick the 'personal use' license the first time u open it — couple clicks on their site, no payment info needed. if it says ur trial expired instead, go back through account settings and make sure personal use is actually selected, not the 30-day trial",
      "plate generator output doesn't match the pcb, wrong size or key count": "double check the array u pasted into ai03's plate generator matches ur actual switch count and layout — each empty `\"\"` in the array is one key. also make sure it didn't get scaled on import into fusion360 — right click the imported sketch, check its dimensions, and rescale if it's off before extruding",
    },
  },

  "create-devboard": {
    name: "How to Design & Order Your Own Custom Devboard (PCB)",
    steps: [
      {
        message: "yooo let's design u a custom PCB devboard! :yay: (this walkthrough's adapted from Hack Club's OnBoard program, github.com/hackclub/OnBoard — full credit to them for the original guide) we'll go through designing it, then ordering the actual physical board",
        checkNext: "ready to get started? (yes/no)",
      },
      {
        message: "design rules to keep in mind the whole way through:\n• 2 or 4-layer FR-4 board\n• keep the default 1.6mm thickness (anything else forces the pricier Standard PCBA)\n• 0.3mm traces for signals / 0.5mm for power\n• 0.7mm vias with a 0.3mm hole\n\nopen up KiCad (recommended, free) or EasyEDA (web-based, no install) and start a new project",
        checkNext: "got your PCB software open and a new project started? (yes/no)",
      },
      {
        message: "place your microcontroller, USB-C connector, 3.3V LDO regulator and decoupling caps in the schematic editor and wire it all up, then switch to the PCB layout editor — draw a ground plane and route every trace",
        checkNext: "schematic wired and PCB routed? (yes/no)",
      },
      {
        message: "run DRC (Design Rule Check) until it comes back clean — zero errors — then export your fab files: gerber.zip, bom.csv, position/CPL csv, and a PDF of your schematic",
        checkNext: "DRC clean and gerber.zip + schematic.pdf exported? (yes/no)",
      },
      {
        message: "head to JLCPCB.com and upload your gerber.zip:\n• base material FR-4\n• layers auto-detect from the gerbers\n• bump PCB qty to 5 (the grant covers that many)",
        checkNext: "base options set? (yes/no)",
        screenshot: "create-devboard/02.webp",
      },
      {
        message: "next, PCB specifications:\n• leave thickness at 1.6mm (don't touch this one, it's what keeps u on Economic pricing)\n• pick whatever color u want (green/blue/black are cheapest)\n• HASL or ENIG for surface finish",
        checkNext: "specs set? (yes/no)",
        screenshot: "create-devboard/03.webp",
      },
      {
        message: "now assembly:\n• set PCBA type to Economic (Standard is way pricier)\n• choose 2 of your 5 boards for component assembly so the grant covers it",
        checkNext: "assembly set to Economic? (yes/no)",
        screenshot: "create-devboard/04.webp",
      },
      {
        message: "upload your BOM — bom.csv + positions.csv from KiCad (or BOM_PCB.csv + PickAndPlace.csv from EasyEDA)",
        checkNext: "BOM uploaded? (yes/no)",
        screenshot: "create-devboard/05.webp",
      },
      {
        message: "double check every part's orientation matches the preview JLCPCB shows u — eyeball each one before moving on, a flipped part is a dead board",
        checkNext: "orientation looking right? (yes/no)",
        screenshot: "create-devboard/06.webp",
      },
      {
        message: "stencil is optional and adds cost — leave it on 'No' unless u specifically want one for hand assembly",
        checkNext: "stencil setting sorted? (yes/no)",
        screenshot: "create-devboard/07.webp",
      },
      {
        message: "get to checkout, enter your shipping address, and BEFORE paying — screenshot the cart showing your total cost and save it as cart.png. u need this exact file for the PR later",
        checkNext: "got your cart.png? (yes/no)",
        screenshot: "create-devboard/08.webp",
      },
      {
        message: "pay directly — it's the recommended option, and u get refunded if your files don't pass review — then hit submit order",
        checkNext: "order submitted? (yes/no)",
        screenshot: "create-devboard/09.webp",
      },
      {
        message: "that's it!! your board's ordered and on its way from JLCPCB :yesyes: once it arrives, solder it up and u've got yourself a real working custom PCB — nice work. once it's built, ship it as a project on Pixl (https://pixl.hackclub.com/projects/) so it counts here too",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "doesn't have kicad or easyeda installed": "kicad's free and open-source — grab it from https://www.kicad.org/. easyeda's web-based (https://easyeda.com/) so there's nothing to install at all, just make an account and start a project",
      "pcb has drc errors": "same deal as any DRC error — usually two traces sitting too close together, or a net that isn't fully connected yet. run the design rule checker, click each violation to jump straight to it, and either widen the clearance or re-route that one spot",
      "not sure what layer count or thickness to pick": "2-layer is simplest and cheapest for a first board — go 4-layer only if you actually need the extra routing room. thickness should always stay at the default 1.6mm, changing it forces the pricier Standard PCBA option",
      "jlcpcb assembly or bom upload error": "make sure Economic PCBA is actually selected (not Standard), and that your BOM csv headers match what JLCPCB expects — LCSC Part #, Quantity, Designator. a mismatched header name is the most common reason the upload silently fails to map parts",
    },
  },

  "submit-ysws-guidelines": {
    name: "YSWS Project Submission Guidelines & Quality Rules",
    steps: [
      {
        message: "yooo let's get your YSWS project ready to submit! :yay: first, is your code on a public GitHub repo?",
        checkNext: "got your public repo link? (yes/no)",
        screenshot: null,
      },
      {
        message: "sweet! does the repo have a README and multiple commits showing your progress? (single-commit repos for high-hour projects get deflated/rejected!)",
        checkNext: "does it have multiple commits? (yes/no)",
        screenshot: null,
      },
      {
        message: "nice! now we need a playable URL. this must be a public link where anyone can run/play it (Vercel, itch.io, Netlify, direct binary download). raw code zips or google colab/jupyter notebooks are NOT allowed",
        checkNext: "got a playable URL? (yes/no)",
        screenshot: null,
      },
      {
        message: "awesome! for your hour count: time spent on art/assets (sprites, 3D models) is capped at 25% max of the total hours. also, AI code is allowed but simple 'AI slop' (single-prompt output with no edit/debugging) is banned.",
        checkNext: "do your hours match these rules? (yes/no)",
        screenshot: null,
      },
      {
        message: "lastly, make sure you take a screenshot of your app (.png/.webp, no GIFs!) and get your Hackatime dashboard URL ready as justification for your hours",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "what if i built a hardware project": "for hardware, your repo must include a Bill of Materials (BOM) with specific parts, PCB schematics/project files, 3D models in .STEP format (not just .STL), and firmware code!",
      "my project is a library or CLI": "libraries and CLIs must be published to a package manager (npm, PyPI, crates.io) with complete API usage docs so others can use them easily!",
      "can i submit team/duplicate projects": "yes, but you must fill out the 'Override Duplicate Justification' field and explain who worked on what so hours aren't double-counted.",
      "what if i made a downloadable game": "you need a pre-compiled build for at least one major OS (Windows/macOS/Linux) — no source-only zips! if it needs special install steps (like a Gatekeeper bypass on Mac), put those in the README or itch.io description.",
      "what if my game is web playable": "just needs to be hosted somewhere allowed — GitHub Pages, Vercel, or itch.io as a play-in-browser game all work.",
      "what if my game is for sprig or custom hardware": "if there's an online emulator (Sprig has one), link straight to it with the game loaded, or link a releases page with the ROM + emulator + instructions. no emulator, like with custom hardware? you need a demo video clearly showing it working on the real thing.",
      "what if my game is on roblox": "if publishing is funded, ship it for all ages. otherwise it needs to be published for ages 16+ (free) PLUS a demo video clearly showing the core gameplay.",
      "what if i made a website or web app": "needs a public, non-ephemeral URL — no login walls (if it needs an account, give reviewers demo credentials), and it can't be on a disallowed host like Streamlit.",
      "what if i made a mobile app": "best case is a real Play Store/App Store release, but a TestFlight/internal test build works too, or a signed APK/IPA with sideload instructions. a demo video showing every feature is only the fallback if none of those are possible.",
      "what if i made a desktop app": "needs a build for Windows, Mac, or Linux — either a GitHub release with an installer (.exe/.dmg/.AppImage/.msi) or a release to somewhere like the Microsoft Store, Mac App Store, or Homebrew.",
      "what if i made a browser extension": "gotta be published to the Chrome or Firefox store. if it's still in review and you need a quick turnaround, you can link a ZIP/CRX with load instructions in the meantime — just keep proof it's actually in the review queue somewhere in the repo.",
      "what if i made a discord or slack bot": "needs a working invite link with the right scopes, plus an invite to a test server/channel where reviewers can see it running. can't self-host it? that's only OK if it's genuinely a cost thing (like an API charging per call) — then detailed self-host instructions work instead.",
      "can i host it on streamlit or link a google drive demo video": "nope on both — Streamlit's a disallowed host (use Vercel, Railway, Render, or Nest instead), and Google Drive links or weird proprietary video formats aren't allowed either. upload demo videos to YouTube, Vimeo, or a hosted .mp4 instead.",
    },
  },

  "create-midi": {
    name: "How to Build Your Own MIDI Controller (Blueprint)",
    steps: [
      {
        message: "yooo let's build your own custom MIDI controller! :yay: (guide from Hack Club Blueprint, https://blueprint.hackclub.com/starter-projects/midi) First, do you have KiCad installed and ready to create your schematic?",
        checkNext: "got KiCad installed? (yes/no)",
        screenshot: null,
      },
      {
        message: "sweet! in KiCad Schematic Editor, place your microcontroller (like the XIAO RP2040 or Raspberry Pi Pico), your rotary potentiometers (B10K), and tactile arcade buttons.",
        checkNext: "placed your components in schematic? (yes/no)",
        screenshot: null,
      },
      {
        message: "nice! connect potentiometers to analog ADC pins (GP26-28), buttons to digital GPIO pins with internal pullups to GND, and add an optional ST7735R TFT LCD or PCM5100 DAC for sound!",
        checkNext: "schematic wired up? (yes/no)",
        screenshot: null,
      },
      {
        message: "awesome! convert to PCB, route your traces, pour a ground plane on both layers, run DRC to check for errors, and export Gerbers + BOM for manufacturing (e.g. JLCPCB).",
        checkNext: "pcb routed and checked? (yes/no)",
        screenshot: null,
      },
      {
        message: "lastly, flash CircuitPython with `adafruit_midi`, `keypad`, and `rotaryio` libraries to send MIDI USB note/CC events directly to your DAW (FL Studio, Ableton, GarageBand)! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how do i send midi notes in circuitpython": "import `usb_midi` and `adafruit_midi` (from `adafruit_midi.note_on import NoteOn`). Send `midi.send(NoteOn(60, 127))` for Middle C, and `NoteOff(60, 0)` on release!",
      "which microcontrollers work best": "the Raspberry Pi Pico or Seeed Studio XIAO RP2040 work great because they have native USB-MIDI support with CircuitPython!",
    },
  },

  "create-mouse": {
    name: "Squeak: Build a Custom Mouse (Blueprint)",
    steps: [
      {
        message: "let's build your own custom USB optical mouse! :yay: (guide from Hack Club Blueprint, https://blueprint.hackclub.com/starter-projects/squeak) First, duplicate the starter CAD files on Onshape or open Fusion360.",
        checkNext: "got your CAD workspace ready? (yes/no)",
        screenshot: null,
      },
      {
        message: "nice! sketch the bottom base profile with mounting posts for your PCB and optical sensor lens.",
        checkNext: "base sketch finished? (yes/no)",
        screenshot: null,
      },
      {
        message: "sweet! extrude your palm rest shell, add flexible button cutouts for left/right click, and create the center slot for the scroll wheel.",
        checkNext: "top shell and clickers modeled? (yes/no)",
        screenshot: null,
      },
      {
        message: "awesome! in KiCad, wire the optical sensor (PMW3360/ADNS5050), microswitches (Kailh/Omron), and rotary encoder to your RP2040 MCU.",
        checkNext: "pcb schematic and layout done? (yes/no)",
        screenshot: null,
      },
      {
        message: "3D print your shell, assemble the PCB with screws, and flash QMK or CircuitPython mouse firmware! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "what sensor should i use": "the PMW3360 or ADNS-5050 optical navigation sensors are the standard choice for DIY mice with high tracking precision!",
    },
  },

  "create-split-keyboard": {
    name: "How to Build a Split Wireless Keyboard (Blueprint)",
    steps: [
      {
        message: "let's build a wireless ergonomic split keyboard! :yay: (guide from Hack Club Blueprint, https://blueprint.hackclub.com/starter-projects/split-keyboard) First, install KiCad and the Ergogen / switch footprint libraries.",
        checkNext: "ready with KiCad and switch footprints? (yes/no)",
        screenshot: null,
      },
      {
        message: "layout your key matrix (Kailh Choc or MX switch sockets with 1N4148 diodes) across both left and right PCB halves.",
        checkNext: "matrix layout complete? (yes/no)",
        screenshot: null,
      },
      {
        message: "add nice!nano (nRF52840) wireless microcontrollers, JST LiPo battery connectors, and power slider switches.",
        checkNext: "controllers and power wired? (yes/no)",
        screenshot: null,
      },
      {
        message: "route the PCB, export Gerbers, and design 3D-printable top plate and bottom case files in Onshape / Fusion 360.",
        checkNext: "case and pcb ready? (yes/no)",
        screenshot: null,
      },
      {
        message: "build ZMK firmware via GitHub Actions, flash both halves over USB, and pair over Bluetooth! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how does bluetooth pairing work": "ZMK firmware handles BLE automatically between the central (left) and peripheral (right) halves, and connects to your computer/phone!",
    },
  },

  "create-flight-controller": {
    name: "How to Build a Drone/Rocket Flight Controller (Blueprint)",
    steps: [
      {
        message: "let's design an aerospace flight controller for drones or model rockets! :yay: (guide from Hack Club Blueprint, https://blueprint.hackclub.com/starter-projects/flightcontroller) First, setup KiCad with STM32 or RP2040 MCU libraries.",
        checkNext: "ready with MCU libraries? (yes/no)",
        screenshot: null,
      },
      {
        message: "in Schematic, place your MCU, an IMU 6-axis gyro/accelerometer (ICM-42688-P or MPU-6000), and a barometer (BMP280) for altitude sensing.",
        checkNext: "sensors placed in schematic? (yes/no)",
        screenshot: null,
      },
      {
        message: "add an SPI MicroSD card slot for blackbox data logging, PWM motor/servo output headers, and a 5V/3.3V power regulation circuit.",
        checkNext: "power and peripherals wired? (yes/no)",
        screenshot: null,
      },
      {
        message: "route a 4-layer PCB with solid internal GND and power planes to minimize RF motor noise, run DRC, and export Gerbers for JLCPCB.",
        checkNext: "4-layer PCB routed? (yes/no)",
        screenshot: null,
      },
      {
        message: "solder components, flash Betaflight or custom C++/Arduino flight stabilization code, and take flight! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "why 4 layers": "flight controllers switch high motor currents, so internal ground planes prevent sensor noise from throwing off the gyroscope.",
    },
  },

  "create-blinky": {
    name: "How to Build a 555 LED Chaser Blinky Board (Blueprint)",
    steps: [
      {
        message: "let's build a classic 555 timer LED Chaser Blinky Board! :yay: (guide from Hack Club Blueprint, https://blueprint.hackclub.com/starter-projects/blinky) Open EasyEDA or KiCad.",
        checkNext: "EDA software opened? (yes/no)",
        screenshot: null,
      },
      {
        message: "place the NE555 timer IC in astable multivibrator mode, connected to a CD4017 decade counter IC clock input.",
        checkNext: "555 and 4017 placed in schematic? (yes/no)",
        screenshot: null,
      },
      {
        message: "wire 10 LEDs with current limiting resistors (330 ohm) to the output pins Q0 through Q9, and add a potentiometer to adjust speed.",
        checkNext: "leds and pot wired? (yes/no)",
        screenshot: null,
      },
      {
        message: "switch to PCB layout, arrange the LEDs in a circle or fun pattern, draw silkscreen art, and export Gerbers!",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how does the speed adjust": "the potentiometer changes the RC timing charge rate into pin 2/6 of the 555, altering the output pulse frequency.",
    },
  },

  "create-controller-pad": {
    name: "Pathfinder: Custom Game Controller / eFidget (Pathfinder)",
    steps: [
      {
        message: "let's build your own custom handheld game controller and e-fidget! :yay: (guide from https://pathfinder.hackclub.com) Open KiCad.",
        checkNext: "KiCad open? (yes/no)",
        screenshot: null,
      },
      {
        message: "add a Raspberry Pi Pico / RP2040, tactile D-pad switches, action buttons, and an I2C OLED display (SSD1306).",
        checkNext: "components placed? (yes/no)",
        screenshot: null,
      },
      {
        message: "route your PCB with smooth ergonomic curves and custom silkscreen artwork.",
        checkNext: "pcb routed? (yes/no)",
        screenshot: null,
      },
      {
        message: "flash GP2040-CE or CircuitPython firmware to emulate an XInput / DirectInput gamepad for PC or phone gaming! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "what firmware should i use": "GP2040-CE is super fast with sub-1ms input latency and built-in web configuration!",
    },
  },

  "create-sensor-pcb": {
    name: "Hermes: Environmental Sensor Data PCB (Hermes)",
    steps: [
      {
        message: "let's build an environmental telemetry sensor board! :yay: (guide from https://hermes.hackclub.com) Open KiCad.",
        checkNext: "ready to design? (yes/no)",
        screenshot: null,
      },
      {
        message: "add an ESP32 or RP2040 MCU, a BME280 sensor (temp, humidity, pressure), and a light sensor (BH1750) over I2C.",
        checkNext: "sensors wired in schematic? (yes/no)",
        screenshot: null,
      },
      {
        message: "layout your board, pour ground planes, export Gerbers, and order PCBA.",
        checkNext: "pcb exported? (yes/no)",
        screenshot: null,
      },
      {
        message: "write firmware in Arduino / ESP-IDF to read sensor values and stream them via Wi-Fi / MQTT to a live web dashboard! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how to view data": "you can publish to an MQTT broker or InfluxDB and graph it with Grafana in real time!",
    },
  },

  "create-custom-keycaps": {
    name: "3D CAD Custom Keycaps & Knobs in Fusion360 (Highway)",
    steps: [
      {
        message: "let's model custom mechanical keyboard keycaps and rotary knobs! :yay: (guide from Highway, https://highway.hackclub.com/guides/custom-keycaps) Open Fusion 360.",
        checkNext: "Fusion 360 open? (yes/no)",
        screenshot: null,
      },
      {
        message: "create a sketch of the standard Cherry MX cross stem (4.1mm x 1.25mm crosses with 0.15mm printer tolerance).",
        checkNext: "stem sketch done? (yes/no)",
        screenshot: null,
      },
      {
        message: "model your keycap outer profile using Loft, Extrude, and Fillet tools, then shell the underside.",
        checkNext: "outer keycap body finished? (yes/no)",
        screenshot: null,
      },
      {
        message: "emboss custom artwork or novelty legends on top, export as .STEP or .STL, and 3D print with resin or 0.2mm nozzle FDM! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "why are my stems loose or too tight": "3D printers shrink slightly — adjust the cross slot width by ±0.05mm in your CAD sketch until it has a snug friction fit.",
    },
  },

  "learn-kicad-solder": {
    name: "Learn KiCad PCB Design with Solder",
    steps: [
      {
        message: "welcome to PCB design with Solder! :yay: (guide from https://solder.hackclub.com/start) First, install KiCad 8.",
        checkNext: "KiCad 8 installed? (yes/no)",
        screenshot: null,
      },
      {
        message: "Schematic Capture: Place symbols from standard libraries, assign power nets (VCC, GND), and connect pins.",
        checkNext: "schematic captured? (yes/no)",
        screenshot: null,
      },
      {
        message: "Footprint Assignment: Map every symbol to its physical footprint (0805 passives, through-hole headers, QFN chips).",
        checkNext: "footprints assigned? (yes/no)",
        screenshot: null,
      },
      {
        message: "PCB Routing: Switch to PCB Editor, place components, route tracks on front/back copper layers, and press 'B' to fill ground zones.",
        checkNext: "board routed? (yes/no)",
        screenshot: null,
      },
      {
        message: "Run DRC (Design Rules Checker) to catch disconnected nets, then export Gerbers & drill files ready for fabrication! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "what is DRC": "DRC verifies that track clearances, via sizes, and unrouted airwires satisfy manufacturing limits so your PCB works.",
    },
  },

  "create-easel-lang": {
    name: "Easel: Build Your Own Programming Language",
    steps: [
      {
        message: "yooo let's create your very own programming language from scratch! :yay: (guide from https://easel.hackclub.com/orpheus-finds-easel) Setup a new Node.js project: `mkdir mylang && cd mylang && npm init -y`.",
        checkNext: "project initialized? (yes/no)",
        screenshot: null,
      },
      {
        message: "Step 1: The Lexer (Tokenizer) — write a function that loops over the source code characters and outputs tokens (e.g. `{ type: 'KEYWORD', value: 'prepare' }`, `{ type: 'NUMBER', value: 42 }`).",
        checkNext: "lexer tokenizing input? (yes/no)",
        screenshot: null,
      },
      {
        message: "Step 2: The Parser — convert your stream of tokens into an Abstract Syntax Tree (AST) using recursive descent parsing.",
        checkNext: "parser producing AST? (yes/no)",
        screenshot: null,
      },
      {
        message: "Step 3: The Interpreter (Evaluator) — walk the AST nodes recursively, managing a symbol environment for variables, functions, and control flow.",
        checkNext: "interpreter evaluating expressions? (yes/no)",
        screenshot: null,
      },
      {
        message: "Step 4: Build an interactive CLI REPL and standard library functions, and ship your new language! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "what language should i write it in": "JavaScript/TypeScript, Python, or Rust all make great host languages for building interpreters!",
    },
  },

  "create-godot-platformer": {
    name: "Build a 2D Platformer in Godot Engine (Daydream)",
    steps: [
      {
        message: "let's build a 2D platformer game in Godot Engine! :yay: (guide from Daydream, https://daydream.jumpstart.hackclub.com/attendee/guide.html) First, install Godot 4 from https://godotengine.org/.",
        checkNext: "Godot 4 installed? (yes/no)",
        screenshot: null,
      },
      {
        message: "create a new 2D scene with a `CharacterBody2D` root, an `AnimatedSprite2D` with idle/walk/jump animations, and a `CollisionShape2D`.",
        checkNext: "player scene setup? (yes/no)",
        screenshot: null,
      },
      {
        message: "attach a GDScript to the player using `velocity.x = direction * SPEED`, applying gravity (`velocity.y += gravity * delta`), and calling `move_and_slide()`.",
        checkNext: "player movement script working? (yes/no)",
        screenshot: null,
      },
      {
        message: "create a TileMapLayer with 2D terrain tiles, platform collisions, camera follow (`Camera2D`), and collectible coins (`Area2D`).",
        checkNext: "level and collectibles built? (yes/no)",
        screenshot: null,
      },
      {
        message: "add win/game over screens, export as an HTML5 web build, and publish to itch.io! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how to fix one-way platforms": "in your TileSet collision polygon settings, check 'One Way' so the player can jump through from beneath!",
    },
  },

  "rice-arch-linux": {
    name: "Rice Your Arch Linux Desktop (Riceathon)",
    steps: [
      {
        message: "let's customize and rice your Linux desktop! :yay: (guide from Riceathon, https://riceathon.hackclub.com/better-guide/guide.html) Pick your window manager or compositor (Hyprland, i3wm, or bspwm).",
        checkNext: "window manager chosen? (yes/no)",
        screenshot: null,
      },
      {
        message: "install a status bar (Waybar or Polybar) and configure modules for CPU, memory, battery, workspaces, and clock.",
        checkNext: "status bar running? (yes/no)",
        screenshot: null,
      },
      {
        message: "configure your terminal emulator (Kitty or Alacritty) with a Nerd Font (JetBrains Mono) and a cohesive colorscheme (Catppuccin, Gruvbox, Nord).",
        checkNext: "terminal themed? (yes/no)",
        screenshot: null,
      },
      {
        message: "setup an application launcher (Wofi or Rofi), notification daemon (Dunst), and wallpaper daemon (Hyprpaper / Swaybg).",
        checkNext: "launcher and visuals configured? (yes/no)",
        screenshot: null,
      },
      {
        message: "manage and publish your dotfiles using Git and GNU Stow to share your rice with the community! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how to sync dotfiles": "use GNU Stow (`stow hyprland kitty waybar`) to symlink configuration folders into `~/.config/` from your git repository!",
    },
  },

  "create-oscillart": {
    name: "Oscillart: Sine Wave Audio & Visualizer",
    steps: [
      {
        message: "let's synthesize audio frequencies and visual waveforms with sine waves! :yay: (guide from Oscillart, https://oscillart.athena.hackclub.com/) Create an `index.html` with an HTML5 `<canvas>` element.",
        checkNext: "html file ready? (yes/no)",
        screenshot: null,
      },
      {
        message: "initialize the Web Audio API `AudioContext` and create an `OscillatorNode` (`osc.type = 'sine'`) connected to a `GainNode` and `audioCtx.destination`.",
        checkNext: "audio oscillator generating sound? (yes/no)",
        screenshot: null,
      },
      {
        message: "connect an `AnalyserNode` with `analyser.getByteFrequencyData()` to read real-time amplitude and frequency bins.",
        checkNext: "audio analysis wired? (yes/no)",
        screenshot: null,
      },
      {
        message: "in a `requestAnimationFrame` loop, draw Lissajous figures and mathematical wave curves on the Canvas using `Math.sin()` and audio data.",
        checkNext: "waveform rendering on canvas? (yes/no)",
        screenshot: null,
      },
      {
        message: "add interactive keyboard controls to play melodies while generating colorful audio-reactive art! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "why no sound on page load": "modern browsers block audio until the user interacts with the page — start or resume the `AudioContext` on a button click!",
    },
  },

  "create-react-tierlist": {
    name: "Build a Customizable Tier List in React (Jams)",
    steps: [
      {
        message: "let's build a drag-and-drop Tier List maker in React! :yay: (guide from Hack Club Jams, https://jams.hackclub.com/jam/tier-list) Initialize with `npm create vite@latest tierlist -- --template react`.",
        checkNext: "Vite React app created? (yes/no)",
        screenshot: null,
      },
      {
        message: "setup tier rows state (`['S', 'A', 'B', 'C', 'D', 'F']`) with customizable colors, labels, and an unranked item pool.",
        checkNext: "tier state and UI rows created? (yes/no)",
        screenshot: null,
      },
      {
        message: "integrate HTML5 Drag and Drop or `@hello-pangea/dnd` to allow reordering and moving items between tier rows.",
        checkNext: "drag and drop working? (yes/no)",
        screenshot: null,
      },
      {
        message: "add an image upload / link input to allow users to add custom items, and use `html2canvas` to export the tier list as a PNG image! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how to save tier lists": "use `localStorage.setItem('tierlist', JSON.stringify(tiers))` to automatically preserve state across reloads!",
    },
  },

  "create-node-express-backend": {
    name: "Intro to Backend with Node.js & Express",
    steps: [
      {
        message: "let's build a REST API backend! :yay: (guide from https://express.athena.hackclub.com/home) Initialize your project with `npm init -y` and install `express cors dotenv`.",
        checkNext: "npm packages installed? (yes/no)",
        screenshot: null,
      },
      {
        message: "in `server.js`, setup Express with middleware: `app.use(express.json())` and `app.use(cors())`.",
        checkNext: "server boilerplate configured? (yes/no)",
        screenshot: null,
      },
      {
        message: "create CRUD endpoints: `app.get('/api/items')`, `app.post('/api/items')`, `app.delete('/api/items/:id')` with input validation.",
        checkNext: "CRUD routes implemented? (yes/no)",
        screenshot: null,
      },
      {
        message: "connect a persistent SQLite database with `better-sqlite3` and deploy your API to Railway or Nest! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how to test endpoints": "use `curl`, Bruno, or Thunder Client in VS Code to send test GET and POST requests to `http://localhost:3000`!",
    },
  },

  "draw-dino-pr": {
    name: "Draw a Dino: Your First GitHub Pull Request",
    steps: [
      {
        message: "welcome to open source! :yay: (guide from https://draw-dino.hackclub.com/) Draw your dinosaur illustration (PNG/SVG, digital art, or pixel art).",
        checkNext: "got your dinosaur drawing? (yes/no)",
        screenshot: null,
      },
      {
        message: "fork the repository on GitHub to your profile, then clone it locally: `git clone <your-fork-url>`.",
        checkNext: "repo forked and cloned? (yes/no)",
        screenshot: null,
      },
      {
        message: "create a new branch: `git checkout -b dino-<your-name>`, and add your dinosaur image into the `dinosaurs/` folder.",
        checkNext: "branch created and image added? (yes/no)",
        screenshot: null,
      },
      {
        message: "commit and push: `git add .`, `git commit -m 'feat: add <your-name> dino'`, and `git push origin dino-<your-name>`.",
        checkNext: "changes pushed to GitHub? (yes/no)",
        screenshot: null,
      },
      {
        message: "open GitHub, click 'Compare & pull request', write a short description, and submit your PR! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "what is a fork": "a fork is your personal copy of the project on GitHub where you can make changes safely before proposing them upstream via a Pull Request!",
    },
  },

  "create-beautiful-readme": {
    name: "How to Make Beautiful GitHub READMEs (Highway)",
    steps: [
      {
        message: "let's make your project README look awesome! :yay: (guide from Highway, https://highway.hackclub.com/guides/beautiful-readmes) Start with a banner image and centered title.",
        checkNext: "banner and title added? (yes/no)",
        screenshot: null,
      },
      {
        message: "add Shields.io status badges (License, Tech Stack, Version, Live Demo link) right under the header.",
        checkNext: "badges added? (yes/no)",
        screenshot: null,
      },
      {
        message: "embed visual demo media (a high quality GIF, web screenshot, or short video) demonstrating key features.",
        checkNext: "demo media added? (yes/no)",
        screenshot: null,
      },
      {
        message: "include clean Quickstart instructions with code fences (`npm install`, `npm run dev`), feature list, architecture overview, and MIT license! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how to generate badges": "visit https://shields.io to generate custom SVG badges for GitHub stars, license, discord, build status, and languages!",
    },
  },

  "create-business-card": {
    name: "How to Build a Custom PCB Business Card (NFC / USB / Blinky)",
    steps: [
      {
        message: "yooo let's design a custom interactive PCB business card! :yay: (inspired by Hack Club OnBoard & Blueprint hardware projects) A PCB business card fits right in your wallet (85.6mm x 53.98mm credit card format) and can beam your portfolio URL via NFC, plug into USB to type your site, or light up LEDs with touch pads!",
        checkNext: "ready to start designing? (yes/no)",
      },
      {
        message: "Step 1: Choose Your Card Tech & Features:\n• *NFC Smart Card*: Uses an NTAG213/NTAG215 chip or etched PCB loop antenna (taps to any iPhone/Android to open your portfolio/LinkedIn instantly)\n• *USB-A Edge Connector*: Etch copper pads directly onto the edge of the PCB so the card plugs straight into a laptop USB port like a USB drive / BadUSB\n• *Blinky / Touch Card*: Uses an ATtiny85/CH32V003 microcontroller with capacitive touch sensing pads and LEDs powered by a slim CR2016/CR2032 coin cell.",
        checkNext: "picked your features and ready for schematic? (yes/no)",
      },
      {
        message: "Step 2: Schematic & Sizing in KiCad:\n• Create a new project in KiCad.\n• Set Edge.Cuts dimensions to 85.6mm x 53.98mm with 3mm rounded corner fillets.\n• Place your components: NFC chip / Microcontroller, 0805 passives, reverse-mount LEDs, and USB connector pins.\n• Wire power (VBUS/3.3V), GND ground planes, and signal nets.",
        checkNext: "schematic wired up and board outline set? (yes/no)",
      },
      {
        message: "Step 3: Vector Art & Gold Silkscreen Aesthetics:\n• Convert your personal logo, avatar, or socials into high-res SVG or PNG (use KiCad Image Converter tool).\n• Place graphics on the Front Silkscreen (`F.SilkS`) layer for crisp white text/art.\n• Expose shiny gold/silver copper: Remove the solder mask over selected copper areas (`F.Mask`) so JLCPCB's ENIG gold plating shines through as metallic art!",
        checkNext: "art placed and routed with DRC clean? (yes/no)",
      },
      {
        message: "Step 4: Fab & Ordering on JLCPCB:\n• Export Gerber zip file from KiCad.\n• On JLCPCB: select *0.8mm or 1.0mm thickness* (thinner than standard 1.6mm so it feels like a real sleek credit card in a wallet!).\n• Surface Finish: *ENIG (Electroless Nickel Immersion Gold)* for gorgeous gold contacts and lettering.\n• Solder Mask: Matte Black, Classic Purple, or White look awesome for business cards!",
        checkNext: "fab files configured and ordered? (yes/no)",
      },
      {
        message: "Step 5: Flash & Test:\n• For NFC cards: Install the free *NFC Tools* app on your phone, write a custom NDEF URL record with your GitHub or portfolio link, and tap your card to your phone to test!\n• For USB/Blinky cards: Solder parts, flash your firmware via USB or UPDI, and show off your custom card! :yesyes:",
        checkNext: null,
      },
    ],
    alternateSteps: {
      "how to get gold finish": "Select ENIG (Electroless Nickel Immersion Gold) under Surface Finish in JLCPCB — any copper with solder mask removed will plate in pure shiny gold!",
      "card dimensions": "Standard credit card / business card size is 85.60 mm × 53.98 mm (CR80 format), with 2.88mm to 3.18mm corner radius fillets. Use 0.8mm or 1.0mm PCB thickness.",
      "how to program nfc": "Use the free NFC Tools app on iOS/Android. Open the app, go to Write -> Add a record -> Custom URL -> type your website/GitHub, and tap 'Write' while holding the PCB to the top back of your phone!",
    },
  },

  "start-live": {
    name: "Start a Live Project",
    steps: [
      {
        message: "pick a cool idea you want to build. Live supports software and hardware projects, so choose something you actually want to ship.",
        checkNext: "got an idea you want to build?",
      },
      {
        message: "start building it and keep your work moving toward something real people can use or see. if it needs hardware, Live says it can fund hardware projects.",
        checkNext: "got a first version underway?",
      },
      {
        message: "when your project is ready, head to https://live.hackclub.com/dashboard to ship it. approved build hours add 20 minutes each to the stream.",
        checkNext: "ready to ship it through the Live dashboard?",
      },
      {
        message: "after approval, check https://live.hackclub.com/shop to see what your approved hours can unlock. keep shipping and have fun :yay:",
        checkNext: null,
      },
    ],
    alternateSteps: {},
  },
};

function availableFor(program) {
  const ids = Array.isArray(program?.guides) ? program.guides : [];
  return ids.filter((id) => GUIDES[id]).map((id) => [id, GUIDES[id]]);
}

function isAvailable(program, guideId) {
  return availableFor(program).some(([id]) => id === guideId);
}

// Guide selection used to be `q.includes("hackatime")`, which meant one typo
// killed it: the live gap log has "pixie help me setup hackatimm" recorded as a
// docs miss, and `active_guides` had never held a row. Detection is now two
// passes — a free fuzzy one that catches the typo, then the model for phrasings
// no keyword list would predict.
//
// `subject` groups are synonyms and every group must match; `hints` say the
// person wants to be walked through it rather than just mentioning the word.
//
// The subject list does double duty: mentionsGuideSubject uses it alone to
// decide whether the model pass is worth a call at all, so a synonym missing
// here means that guide is unreachable for anyone who doesn't name it. Hence
// "hours" — "how do i make my coding hours count" is a hackatime question that
// never says hackatime.
const GUIDE_TRIGGERS = [
  [
    "start-live",
    {
      subject: [["live"]],
      hints: ["start", "begin", "build", "ship", "project", "guide", "how"],
    },
  ],
  [
    "create-business-card",
    {
      subject: [["business", "card", "nfc", "badge", "developer", "smartcard"]],
      hints: ["build", "make", "design", "pcb", "order", "create", "how", "setup", "guide"],
    },
  ],
  [
    "submit-ysws-guidelines",
    {
      subject: [["ysws", "submission", "submissions", "guideline", "guidelines", "rules", "rule", "qualify", "requirements"]],
      hints: ["submit", "submission", "rule", "shipped", "hours", "deflate", "reject", "guideline", "guidelines", "how", "guide", "walkthrough", "process"],
    },
  ],
  [
    "create-hackpad",
    {
      subject: [["hackpad", "macropad", "kicad"]],
      hints: ["build", "make", "create", "start", "how", "setup", "set"],
    },
  ],
  [
    "create-devboard",
    {
      subject: [["devboard", "pcb", "circuit", "onboard"]],
      hints: ["build", "make", "design", "order", "create", "how", "setup", "grant"],
    },
  ],
  [
    "create-midi",
    {
      subject: [["midi", "synthesizer", "daw"]],
      hints: ["build", "make", "create", "start", "how", "guide", "setup"],
    },
  ],
  [
    "create-mouse",
    {
      subject: [["mouse", "squeak", "optical"]],
      hints: ["build", "make", "create", "cad", "design", "how", "guide"],
    },
  ],
  [
    "create-split-keyboard",
    {
      subject: [["split", "keyboard", "zmk", "ergonomic"]],
      hints: ["build", "make", "create", "wireless", "how", "guide"],
    },
  ],
  [
    "create-flight-controller",
    {
      subject: [["flight", "drone", "rocket", "controller"]],
      hints: ["build", "make", "create", "design", "how", "guide"],
    },
  ],
  [
    "create-blinky",
    {
      subject: [["blinky", "555", "chaser", "led"]],
      hints: ["build", "make", "create", "solder", "how", "guide"],
    },
  ],
  [
    "create-controller-pad",
    {
      subject: [["pathfinder", "fidget", "efidget", "gamepad"]],
      hints: ["build", "make", "create", "how", "guide"],
    },
  ],
  [
    "create-sensor-pcb",
    {
      subject: [["hermes", "sensor", "telemetry", "environmental"]],
      hints: ["build", "make", "create", "how", "guide"],
    },
  ],
  [
    "create-custom-keycaps",
    {
      subject: [["keycap", "keycaps", "knob", "knobs"]],
      hints: ["cad", "fusion", "model", "3d", "make", "create", "how"],
    },
  ],
  [
    "learn-kicad-solder",
    {
      subject: [["solder", "kicad", "schematic"]],
      hints: ["learn", "start", "begin", "how", "tutorial", "guide"],
    },
  ],
  [
    "create-easel-lang",
    {
      subject: [["easel", "language", "interpreter", "lexer", "parser", "ast"]],
      hints: ["build", "make", "create", "write", "how", "guide"],
    },
  ],
  [
    "create-godot-platformer",
    {
      subject: [["godot", "platformer", "daydream", "2d"]],
      hints: ["build", "make", "create", "game", "how", "guide"],
    },
  ],
  [
    "rice-arch-linux",
    {
      subject: [["rice", "riceathon", "arch", "hyprland", "i3wm", "waybar"]],
      hints: ["how", "guide", "setup", "customize", "theme"],
    },
  ],
  [
    "create-oscillart",
    {
      subject: [["oscillart", "sine", "wave", "audio", "frequency"]],
      hints: ["build", "make", "create", "draw", "how", "guide"],
    },
  ],
  [
    "create-react-tierlist",
    {
      subject: [["tierlist", "tier", "react"]],
      hints: ["build", "make", "create", "drag", "how", "guide"],
    },
  ],
  [
    "create-node-express-backend",
    {
      subject: [["backend", "express", "crud", "rest"]],
      hints: ["build", "make", "create", "api", "how", "guide"],
    },
  ],
  [
    "draw-dino-pr",
    {
      subject: [["dino", "dinosaur", "pull", "pr"]],
      hints: ["draw", "submit", "fork", "how", "guide", "contribute"],
    },
  ],
  [
    "create-beautiful-readme",
    {
      subject: [["readme", "readmes", "markdown", "badges"]],
      hints: ["make", "create", "beautiful", "format", "how", "guide"],
    },
  ],
];

// Budget scales with length because a fixed one is wrong at both ends: 2 edits
// on a three-letter word turns "get" into "git", while 1 edit isn't enough slack
// for a word as long as "hackatime".
function editBudget(word) {
  if (word.length <= 4) return 0;
  if (word.length <= 7) return 1;
  return 2;
}

// Damerau-Levenshtein, not plain Levenshtein: a swapped pair of letters is the
// most common typo there is, and plain edit distance scores it 2, which puts
// "regoin" out of reach of a 1-edit budget for "region". Counting a transposition
// as one edit is what makes the budgets below tight enough to be safe and loose
// enough to be useful.
//
// Stops as soon as an entire row exceeds the budget — this runs per token per
// guide on every message, so the early exit matters more than the exact distance
// once we're past the threshold.
function withinEdits(a, b, budget) {
  if (Math.abs(a.length - b.length) > budget) return false;

  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      row[j] = value;
      if (value < best) best = value;
    }
    if (best > budget) return false;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length] <= budget;
}

function matchesToken(tokens, word) {
  const budget = editBudget(word);
  return tokens.some((t) => (budget === 0 ? t === word : withinEdits(t, word, budget)));
}

// Splitting the question into words once, shared by every pass below.
function tokensOf(question) {
  return (question || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// The free pass. Returns a guide id or null; never makes a network call.
function detectGuideByKeyword(question) {
  const tokens = tokensOf(question);
  if (tokens.length === 0) return null;

  for (const [id, trigger] of GUIDE_TRIGGERS) {
    const hasSubject = trigger.subject.every((group) => group.some((word) => matchesToken(tokens, word)));
    if (hasSubject && trigger.hints.some((word) => matchesToken(tokens, word))) return id;
  }
  return null;
}

function guideChooserPrompt() {
  const catalogue = Object.entries(GUIDES)
    .map(([id, guide]) => `${id}: ${guide.name}`)
    .join("\n");

  return [
    "Pixie can walk someone through a few setup workflows step by step.",
    "",
    "Available walkthroughs:",
    catalogue,
    "",
    "Decide whether this person is asking to be walked through one of them.",
    "Reply with EXACTLY the id, or NONE.",
    "",
    "Pick a walkthrough only when they want to be taken through the process.",
    "If they use action verbs/phrases indicating they want a guide or walkthrough (e.g. \"guide me with\", \"walk me through\", \"tutorial for\", \"walkthrough for\", \"step by step\"), you MUST return the matching guide ID instead of NONE.",
    "Answer NONE for a one-off factual question about the same topic — those are better",
    "answered from the docs than by starting a multi-step walkthrough they didn't ask for.",
  ].join("\n");
}

// Second pass. Only reached when the keyword pass missed AND the message is
// already a help request, so ordinary chat never pays for it. Runs before the
// answer path rather than alongside it — a guide match replaces the answer call
// instead of adding to it.
async function detectGuideByModel(question) {
  try {
    const { text } = await llm.complete(
      {
        baseUrl: config.intent.baseUrl,
        apiKey: config.intent.apiKey,
        model: config.intent.model,
        fallback: config.intent.fallback,
        onRateLimited: config.intent.onRateLimited,
        maxTokens: MAX_TOKENS,
        temperature: 0,
        thinking: { type: "disabled" },
        timeout: TIMEOUT_MS,
        messages: [
          { role: "system", content: guideChooserPrompt() },
          { role: "user", content: question },
        ],
      },
      "guides",
    );

    const label = (text || "").trim().toLowerCase();
    return Object.keys(GUIDES).find((id) => label.startsWith(id)) || null;
  } catch (e) {
    log.debug("guides", `guide selection failed: ${e.message}`);
    return null;
  }
}

// Is there any guide this message could possibly be about? Same fuzzy match as
// the keyword pass, but only on the SUBJECT groups — the hints are dropped, so
// merely naming git or hackatime is enough to qualify.
//
// This exists because the model pass ran on every help-shaped message the
// keyword pass missed, which is nearly all of them: ~1700ms of latency added in
// front of the answer call, to return NONE. A question that never mentions a
// region, git or hackatime — however badly typed — has no guide to choose.
function mentionsGuideSubject(question) {
  const tokens = tokensOf(question);
  if (tokens.length === 0) return false;
  return GUIDE_TRIGGERS.some(([, trigger]) =>
    trigger.subject.every((group) => group.some((word) => matchesToken(tokens, word))),
  );
}

// A keyword match only proves the words *could* be about some guide — not
// that the person actually wants to be walked through it, rather than just
// asking a question that happens to share vocabulary with the trigger list.
// ("how to get pixels" matching shop-purchase, "how does my character level
// up" matching customize-character, and a whole thread's worth of similar
// hijacks all shipped this way — see the individual trigger comments above.)
// Trimming the trigger lists fixes each specific phrase as it's found, but
// it's still a keyword guess; it can't tell "walk me through submitting a
// project" apart from "why did my project's submission get rejected". Every
// keyword hit — not just a keyword miss — now gets confirmed by the same
// model check used below, which is built to draw exactly that distinction
// (see guideChooserPrompt: "Pick a walkthrough only when they want to be
// taken through the process"). Only a message that mentions no guide subject
// at all skips the model call, since there's nothing for it to confirm.
function isExplicitGuideRequest(question) {
  const text = (question || "").toLowerCase();
  return /\b(guide|walkthrough|tutorial|step-by-step|step by step|walk me through|take me through)\b/i.test(text);
}

function detectGuideBySubject(question) {
  const tokens = tokensOf(question);
  if (tokens.length === 0) return null;
  for (const [id, trigger] of GUIDE_TRIGGERS) {
    const hasSubject = trigger.subject.every((group) => group.some((word) => matchesToken(tokens, word)));
    if (hasSubject) return id;
  }
  return null;
}

async function detectGuideIntent(question) {
  if (isExplicitGuideRequest(question)) {
    const bySubject = detectGuideBySubject(question);
    if (bySubject) return bySubject;
  }
  const byKeyword = detectGuideByKeyword(question);
  if (byKeyword) return byKeyword;
  if (!mentionsGuideSubject(question)) return null;
  if (!looksLikeHelpRequest(question)) return null;
  return detectGuideByModel(question);
}

function isExitRequest(text) {
  return EXIT_PATTERN.test(text || "");
}

function stepPayload(step, guideName = null) {
  return {
    message: step.message,
    checkNext: step.checkNext || null,
    screenshot: step.screenshot || null,
    guideName,
  };
}

function startGuide(guideId, threadTs, userId) {
  const guide = GUIDES[guideId];
  if (!guide) return null;

  // A thread only has one guide slot (active_guides is keyed on thread_ts
  // alone). Without this check, a different person asking an unrelated
  // guide-shaped question in the same thread would silently steal that slot
  // mid-walkthrough — db.saveGuide's ON CONFLICT upsert would overwrite
  // whoever was already partway through. Decline instead; they get a normal
  // answer.
  const existing = db.getGuide(threadTs);
  if (existing && existing.user_id && userId && existing.user_id !== userId) return null;

  db.saveGuide(threadTs, guideId, 0, userId);
  return stepPayload(guide.steps[0], guide.name);
}

function isInGuide(threadTs) {
  return !!db.getGuide(threadTs);
}

function cancelGuide(threadTs) {
  db.deleteGuide(threadTs);
}

function classifierPrompt(guide, step, alternateKeys) {
  const alternates = alternateKeys.map((k, i) => `STUCK_${i + 1}: they hit this specific problem — ${k}`).join("\n");

  return [
    `A user is being walked through: "${guide.name}".`,
    `The step they were just given: "${step.message}"`,
    step.checkNext ? `They were asked: "${step.checkNext}"` : "",
    "",
    "Classify their reply as EXACTLY one of these labels, nothing else:",
    `${ADVANCE}: they completed the step, answered yes/affirmative, or are ready to move to the next step`,
    alternates,
    `STUCK_GENERAL: they asked a question about this step or project, need recommendations or advice (e.g. "is hyprland good", "which one do i choose", "how do i do this"), or ran into a problem`,
    `${OTHER}: they said something completely off-topic to someone else (e.g. talking to a friend about unrelated things)`,
    `${DONE}: they want to stop or quit the walkthrough`,
    "",
    "Answer with just the label.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Classifies the user's reply against the current step. Falls back to ADVANCE
// on failure so an API outage can't strand someone mid-guide.
async function classifyStepReply(guide, step, alternateKeys, userResponse) {
  try {
    const { text } = await llm.complete(
      {
        baseUrl: config.intent.baseUrl,
        apiKey: config.intent.apiKey,
        model: config.intent.model,
        fallback: config.intent.fallback,
        onRateLimited: config.intent.onRateLimited,
        maxTokens: MAX_TOKENS,
        temperature: 0.2,
        thinking: { type: "disabled" },
        timeout: TIMEOUT_MS,
        messages: [
          { role: "system", content: classifierPrompt(guide, step, alternateKeys) },
          { role: "user", content: userResponse },
        ],
      },
      "guides",
    );

    const label = (text || "").trim().toUpperCase();
    if (label.startsWith(DONE)) return { kind: DONE };
    if (label.startsWith(OTHER)) return { kind: OTHER };
    if (label === "STUCK_GENERAL") {
      return { kind: STUCK, alternateKey: "question or troubleshooting for this step" };
    }
    if (label.startsWith("STUCK_")) {
      const index = Number(label.slice("STUCK_".length).match(/^\d+/)?.[0]) - 1;
      if (alternateKeys[index]) return { kind: STUCK, alternateKey: alternateKeys[index] };
      return { kind: STUCK, alternateKey: "question or troubleshooting for this step" };
    }
    return { kind: ADVANCE };
  } catch (e) {
    log.debug("guides", `step classification failed (${e.message}), advancing`);
    return { kind: ADVANCE };
  }
}

function stuckAnswerPrompt(guide, step, alternateKey, canned, inHelpChannel) {
  return [
    `A user is being walked through: "${guide.name}".`,
    `The exact step they're currently on: "${step.message}"`,
    `They've hit this general kind of problem: ${alternateKey}`,
    `Pixie's own fallback line for this (only worth using if you truly have nothing better): ${canned}`,
    "",
    "Give a REAL, specific, technical answer — using your own general knowledge of the tools involved (KiCad,",
    "Fusion360, PCB design, electronics, Linux/package managers, whatever's relevant), exactly like you would for",
    "any tech question. Even if their message is vague ('i'm struggling with this', 'this isn't working', 'stuck') —",
    "don't deflect to asking someone else. Think about what commonly goes wrong at THE EXACT STEP quoted above and",
    "give concrete troubleshooting for it: what to check, what the usual fix is — the way an experienced maker",
    "helping a friend over Discord would, not a support script pointing them elsewhere.",
    "Only mention #hackpad as a closing line if you genuinely can't offer anything useful even with the step's",
    "context — never make that the whole answer, and never make it the first thing you say.",
    ...answer.VOICE,
    "Keep it short — 1-3 sentences, unless real troubleshooting specifics genuinely need more room.",
    answer.pixlGuardrail(inHelpChannel),
  ].join("\n");
}

// A STUCK match used to reply with the exact same canned string every time,
// regardless of what was actually asked — "how do i get X" and "how do i get
// X on Linux using commands" got back the identical generic pointer. This
// gives the model the canned guidance as grounding and lets it actually
// answer what was asked, the same way pixie already does for any other
// general (non-Pixl-specific) question. Falls back to the canned text on any
// failure — an API hiccup should never leave someone stuck with nothing.
async function answerStuckQuestion(guide, step, alternateKey, userResponse, inHelpChannel = false) {
  const canned = guide.alternateSteps[alternateKey];
  try {
    const { text } = await llm.complete(
      {
        baseUrl: config.answer.baseUrl,
        apiKey: config.answer.apiKey,
        model: config.answer.model,
        fallback: config.answer.fallback,
        onRateLimited: config.answer.onRateLimited,
        maxTokens: STUCK_ANSWER_MAX_TOKENS,
        temperature: 0.3,
        thinking: { type: "disabled" },
        timeout: TIMEOUT_MS,
        messages: [
          { role: "system", content: stuckAnswerPrompt(guide, step, alternateKey, canned, inHelpChannel) },
          { role: "user", content: userResponse },
        ],
      },
      "guides",
    );

    const reply = (text || "").trim();
    return reply ? answer.normalizeEmoji(reply) : canned;
  } catch (e) {
    log.debug("guides", `stuck-answer generation failed (${e.message}), using canned reply`);
    return canned;
  }
}

// Shared by continueGuide's ADVANCE branch and advanceGuideByReaction — moves
// to the next step, or finishes the guide when there isn't one.
function advanceToNextStep(threadTs, state, guide) {
  const nextIndex = state.current_step + 1;
  if (nextIndex >= guide.steps.length) {
    db.deleteGuide(threadTs);
    return { message: "all set! lmk if you hit any issues :hii:", screenshot: null, completed: true };
  }

  db.saveGuide(threadTs, state.guide_id, nextIndex, state.user_id);
  return stepPayload(guide.steps[nextIndex]);
}

// A :upvote: reaction on a guide step's own message is an explicit,
// unambiguous "I'm ready for the next step" — no classifier call needed, and
// no yes/no question to answer. Scoped to the guide's owner the same way a
// typed reply is (see the user_id check in continueGuide) so someone else
// reacting on the thread can't advance a walkthrough that isn't theirs.
// Returns the same shape as continueGuide, or null when there's nothing to
// advance (guide already gone, or this isn't the person it was started for).
function advanceGuideByReaction(messageTsOrThreadTs, userId) {
  let messageTs = null;
  let uid = userId;
  let state = null;

  if (typeof messageTsOrThreadTs === "object" && messageTsOrThreadTs !== null) {
    messageTs = messageTsOrThreadTs.messageTs;
    uid = messageTsOrThreadTs.userId || userId;
    state = db.getGuideByMessageTs(messageTs) || db.getGuide(messageTs);
  } else {
    state = db.getGuide(messageTsOrThreadTs) || db.getGuideByMessageTs(messageTsOrThreadTs);
  }

  if (!state) return null;

  const guide = GUIDES[state.guide_id];
  if (!guide) {
    db.deleteGuide(state.thread_ts);
    return null;
  }

  if (state.user_id && uid && state.user_id !== uid) return null;

  return advanceToNextStep(state.thread_ts, state, guide);
}

// Returns a payload to post, or null when the caller should handle the message
// normally instead (off-topic question, or no active guide).
//
//   { message, checkNext }            -> next step / alternate advice
//   { message, completed: true }      -> guide finished
//   { message, cancelled: true }      -> user bailed out
//   null                              -> not a guide reply, answer it normally
async function continueGuide(threadTs, userResponse, userId = null, inHelpChannel = false) {
  const state = db.getGuide(threadTs);
  if (!state) return null;

  const guide = GUIDES[state.guide_id];
  if (!guide) {
    db.deleteGuide(threadTs);
    return null;
  }

  // Thread guide state has no idea who's talking — only the person it was
  // started for can advance or exit it. Without this, a bare "yea" meant for
  // someone else entirely in the same thread reads exactly like ADVANCE to
  // the step classifier, and the guide marches on for a person who never
  // replied to it at all. Anyone else's message just falls through to a
  // normal answer instead.
  if (state.user_id && userId && state.user_id !== userId) return null;

  if (isExitRequest(userResponse)) {
    db.deleteGuide(threadTs);
return { message: "no worries, stopping there — ping me if you wanna pick it back up :hii:", screenshot: null, cancelled: true };
  }

  const step = guide.steps[state.current_step];
  const alternateKeys = Object.keys(guide.alternateSteps || {});
  const verdict = await classifyStepReply(guide, step, alternateKeys, userResponse);

  if (verdict.kind === DONE) {
    db.deleteGuide(threadTs);
    return { message: "cool, stopping the walkthrough — lmk if you need anything else :hii:", cancelled: true };
  }

  // Off-topic: leave the guide parked and let the normal answer path handle it,
  // so a real question mid-guide still gets a real answer.
  if (verdict.kind === OTHER) return null;

  if (verdict.kind === STUCK) {
    const message = await answerStuckQuestion(guide, step, verdict.alternateKey, userResponse, inHelpChannel);
    return { message, checkNext: null, screenshot: null, isAlternate: true };
  }

  return advanceToNextStep(threadTs, state, guide);
}

// Shown once — see buildGuideBlocks below.
const GUIDE_REACTION_HINT = "react :upvote: on this message when you're ready for the next step — or just tell me if you're stuck";

// Builds Slack Block Kit blocks for a guide step. Always returns blocks, even
// with no screenshot — a plain-text step used to be one long paragraph with
// the question mashed onto the end of it, which read as a wall of text
// instead of a guide. Splitting the message and the question into their own
// section blocks (with the question bolded) gives Slack's renderer room to
// actually space them out.
//
// showReactionHint is only true on a guide's very first step: repeating the
// full "react :upvote:..." sentence at the end of EVERY step's text was the
// literal complaint — teach the mechanic once, in its own small context
// block, and never repeat it.
function buildGuideBlocks(result, baseUrl, { showReactionHint = false } = {}) {
  const blocks = [];

  if (result.screenshot) {
    blocks.push({
      type: "image",
      image_url: `${baseUrl}/screenshots/${result.screenshot}`,
      alt_text: "Guide step screenshot",
    });
  }

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: result.message },
  });

  if (result.checkNext) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${result.checkNext}*` },
    });
  }

  if (showReactionHint && result.checkNext) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: GUIDE_REACTION_HINT }],
    });
  }

  return blocks;
}

module.exports = {
  GUIDES,
  availableFor,
  isAvailable,
  detectGuideIntent,
  detectGuideByKeyword,
  mentionsGuideSubject,
  guideChooserPrompt,
  startGuide,
  continueGuide,
  advanceGuideByReaction,
  isInGuide,
  cancelGuide,
  isExitRequest,
  classifierPrompt,
  stuckAnswerPrompt,
  answerStuckQuestion,
  buildGuideBlocks,
  GUIDE_REACTION_HINT,
  ADVANCE,
  STUCK,
  OTHER,
  DONE,
};
