# YSWS Project Submission Guidelines

Source: https://hackclub.gitbook.io/ysws-project-submission-guidelines/BLBRN8LIfoCZhFV6oMNR

These are the official Hack Club YSWS (You Ship, We Ship) project submission
guidelines and quality rules. Helpers use this to check whether a submitted
project is eligible and to walk teens through the requirements.


---

# YSWS Project Submission Guidelines

Every project submitted to a You Ship, We Ship (YSWS) program must include a complete set of required fields in its submission form. This document describes each field and the criteria it must satisfy for the project to be accepted. For exceptions to the standard submission rules, see [Project Exceptions](/ysws-project-submission-guidelines/BLBRN8LIfoCZhFV6oMNR/project-exceptions.md).

For anyone reading this outside of Hack Club HQ - a quote from me (@lfd) in #zrl-land - If you have any feedback feel free to reach out!

> Just want to clarify what the docs are meant to be. They're not supposed to define the limits of what Hack Club can do. It's a recompilation of the rules that have been in place so YSWS authors have something to reference and go back to, not a cage. They're meant to evolve as Hack Club does. If a program comes along tomorrow that might conflict with a rule, then the guidelines will be revised and updated.

Read more about our Quality and Integrity processes here: <https://news.hackclub.com/essays/quality-integrity-manager/>


---

---

# Required Submission Fields

The following table lists every field that must be filled out for a project submission:

| Field                                  | Description                                                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code URL                               | A link to the project's source code repository (see [below](#code-url)).                                                                                                                           |
| Playable URL                           | A public link where the project can be experienced (see [below](#playable-url)).                                                                                                                   |
| First Name                             | Submitter's first name.                                                                                                                                                                            |
| Last Name                              | Submitter's last name.                                                                                                                                                                             |
| Email                                  | Submitter's contact email address.                                                                                                                                                                 |
| Screenshot                             | An image that showcases the project (see [below](#screenshot)).                                                                                                                                    |
| Description                            | A brief explanation of the project (see [below](#description)).                                                                                                                                    |
| Address (Line 1)                       | Submitter's address, first line.                                                                                                                                                                   |
| Address (Line 2)                       | Submitter's address, second line (if applicable).                                                                                                                                                  |
| City                                   | Submitter's city.                                                                                                                                                                                  |
| State / Province                       | Submitter's state or province.                                                                                                                                                                     |
| Country                                | Submitter's country.                                                                                                                                                                               |
| ZIP / Postal Code                      | Submitter's ZIP or postal code.                                                                                                                                                                    |
| Birthday                               | The submitter's date of birth.                                                                                                                                                                     |
| **Override Hours Spent**               | **The approved number of hours for this project (see** [**Override Hours Spent**](/ysws-project-submission-guidelines/BLBRN8LIfoCZhFV6oMNR/override-hours-spent.md)**).**                          |
| **Override Hours Spent Justification** | **Supporting evidence for the approved hours (see** [**Override Hours Spent Justification**](/ysws-project-submission-guidelines/BLBRN8LIfoCZhFV6oMNR/override-hours-spent-justification.md)**).** |

### Sometimes Required Fields

These fields are required in certain cases. When they are required, they must be filled out before the project is submitted to the Unified Database.

| Field                                       | Required When                                                              | Description                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Optional - Override Duplicate Justification | The project shares a Code URL with another project in the Unified Database | Why this project/code is allowed to be submitted in multiple places (e.g., team projects)                           |
| Optional - Override Age Justification       | The project submitter is over 18 at the time of review                     | Why the submitted project is still eligible (usually because the submitter turned 19 between submission and review) |

## Playable URL

The **Playable URL** must be a publicly accessible link where *anyone* can experience the project without requiring significant technical knowledge.

**Acceptable examples:**

* A browser-based game or web application.
* A downloadable executable (installer or standalone binary).
* A hosted demo or interactive prototype.

**Not acceptable:**

* A GitHub release page that contains only source code.
* A project that requires the user to compile or build from source in order to run it.
* A Google Colab notebook, Jupyter notebook runner, or similar hosted notebook environment.\
  These are development tools, not deployable project demos.
* LeetCode, competitive programming, or algorithmic challenge solutions

The project does **not** need to run on every platform. As long as it can be experienced on at least one platform (e.g. Windows, macOS, Linux, or the web), it satisfies this requirement.

## Code URL

The **Code URL** must point to a version-control repository, preferably on GitHub, though other providers (GitLab, Bitbucket, etc.) are permitted. The repository must satisfy the following conditions:

1. It must be **public**, accessible to anyone without authentication.
2. It must be **open source**, with a license that allows others to view and modify the code. The license is **not required** but is a good practice and we highly encourage it!&#x20;
3. It must contain a **README**. The README should explain what the project is, how to set\
   it up, and how to run it.
4. It should have **multiple commits** that reflect the development progress of the project. A repository with a single commit is not acceptable for projects claiming significant hours of work. For example, a 20-hour project with only one commit does not follow the guidelines. The commit history should tell the story of how the project was built over time.

## Screenshot

The **Screenshot** should visually demonstrate the project. Suitable screenshots include:

* A screenshot of the running application or game.
* A photograph of a hardware project or 3D model.
* Any image that gives a clear impression of what the project looks and feels like.

Screenshots cannot be a non-image filetype (ex., no .mp4) and cannot be animated (ex., no .GIF).

## Description

The **Description** should explain what the project is and what it is intended for. It does not need to be overly detailed; a clear, concise summary that conveys the project's purpose and functionality is sufficient.

## Reproducibility

Projects are meant to be used! Although this isn't an official submission field, **all projects submitted to the Unified Database should be able to be recreated by someone with minimal technical knowledge using only the information in the submission.**

For software projects, there should be a README that explains how the project can be experienced and what technology went into making it.

For games, there should be instructions somewhere on how to play the game and, if applicable, how to set it up or download it. These can be in the README or on the page the game is hosted on (e.g., itch.io) as long as they are easily accessible.

For hardware projects, the repo should contain everything someone would need to build the project from scratch. This means, at minimum:

* PCB schematics/wiring diagrams
* CAD files in a modifiable format (acceptable examples: .STEP, .blend; not acceptable examples: .STL)
* A bill of materials
* A README with an explanation of what the project is and any special instructions for building it (i.e., anything beyond soldering parts where they're labeled on the PCB)


---

---

# What Makes a Project "Shipped"?

YSWS programs are supposed to be creative and mostly unconstrained. We don't want you to be worrying about going through a maze of bureaucracy and approvals — we want you to make and run cool programs!

However, all projects eventually end up in the same place, the Unified Database, and all projects in the Unified Database need to be shipped. So, there's one hurdle you do need to jump through when creating your program: how will you make sure the projects you're submitting are shipped, and what's the definition of shipped anyway?

{% hint style="info" %}
**Universal Ship Requirements**

Generally, a shipped project:

* Works (as a minimum viable product, even if it's not fully complete yet)
* Has its full code published to a site like GitHub
* Is able to be experienced by anyone with minimal technical knowledge
* Requires < 2 minutes of setup
* Is reproducible
  {% endhint %}

This guide walks you through exactly what will be accepted (and what will get your project rejected from Unified) for common project types. If you have a unique project or new YSWS model that necessitates a different type of ship, don't worry — just run it by Max or a spot-checker to see what the best format for it would be!

### Table of Contents

#### Project Types

* [Games](#games)
  * [Downloadable](#downloadable)
  * [Web playable](#web-playable)
  * [Platform-specific (Sprig, retro system, custom hardware, etc.)](#platform-specific)
  * [Special Cases](#special-cases)
    * [Roblox](#roblox)
* [Software](#software)
  * [Websites/Web Apps](#websites-web-apps)
  * [Mobile Apps](#mobile-apps)
  * [Desktop Apps](#desktop-apps)
  * [CLIs](#clis)
  * [Libraries](#libraries)
  * [Browser Extensions](#browser-extensions)
  * [Bots (Discord, Slack)](#bots)
  * [Mods/plugins](#mods-plugins)
  * [Contributions (e.g., Pull Requests)](#contributions)
* [Hardware](#hardware)

#### Hosts

* [Disallowed Hosts (and what to use instead)](#disallowed-hosts-and-what-to-use-instead)
  * [Web hosts](#web-hosts)
  * [Demo videos](#demo-videos)

### Games

<details>

<summary>Downloadable</summary>

1. Must have a build for at least one of the major operating systems (no source code dumps!)
2. If special install steps are required (e.g., Gatekeeper bypass), instructions must be included in the README or itch.io description

</details>

<details>

<summary>Web playable</summary>

1. Must be hosted either on an allowed web host (e.g., GitHub Pages, Vercel) or on itch.io as a play-in-browser game

</details>

<details>

<summary>Platform-specific (Sprig, retro system, custom hardware, etc.)</summary>

1. If an online emulator is available (e.g., Sprig), the playable link should either:
   1. go straight to the emulator with the game already loaded
   2. if the game is unable to be encoded within the link, go to a releases page with the game build (e.g., a ROM), a link to the emulator, and instructions on how to run the game within the emulator
2. If no online emulator is available (e.g., custom hardware), the project must include a demo video (on an allowed host) of the project clearly working on the hardware
3. If special install steps are required (e.g., jailbreak + 3rd party software), instructions must be included in the README

</details>

#### Special Cases

<details>

<summary>Roblox</summary>

If the submitter is eligible to publish already or if you are willing to fund them to do so, the game should be published to Roblox for all ages (requires a fee). Otherwise, the game should include links to each of the following somewhere within its Playable URL:

1. The game, published to Roblox for ages 16+ (free)
2. A demo video clearly showing the game being played with its core features

</details>

### Software

<details>

<summary>Websites/Web Apps</summary>

1. Must be published to a public, non-ephemeral URL
2. Must not be gated behind credentials (submitters need to provide demo login information)
3. Must not be hosted on a disallowed host

</details>

<details>

<summary>Mobile Apps</summary>

1. Must include a demo for one or both of the major platforms (iOS and Android) in one or more of the following forms (ordered from most to least preferred):
   1. Full Play Store/iOS App Store release (consider funding Apple developer licenses through your program)
   2. Open/Closed/Internal test release (via TestFlight for iOS)
   3. Signed APK with sideloading instructions or IPA build with sideloading instructions
   4. If none of the above options are possible, demo video on an allowed host that showcases all app features

</details>

<details>

<summary>Desktop Apps</summary>

1. Must have a build for one or more of the major platforms (Windows, Mac, and Linux) in one of the following forms:
   1. GitHub release with an installer/executable file
      * ex. .exe, .deb, .x86\_64, .AppImage, .dmg, .msi
   2. Release to an application host
      * ex. Microsoft Store, Mac App Store, Homebrew, apt

</details>

<details>

<summary>CLIs</summary>

1. Must be released as either
   1. a package on a package host (PyPI, crates.io, npm, etc.)
   2. an executable file build for one or more of the major platforms (Windows, Mac, and Linux)

</details>

<details>

<summary>Libraries</summary>

1. Must be released as a package on a package host (PyPI, crates.io, npm, etc.)
2. Must have documentation such that other users will be able to use it (i.e., doesn't need to be insanely detailed, but should cover all the functions)

</details>

<details>

<summary>Browser Extensions</summary>

1. Must be published to one or both of the Firefox and Chrome stores

Notes:

* If you need a quick turnaround **and the user has proof that their project is in the review process for the Firefox/Chrome store**, it is acceptable to, in the meantime, link a release with a ZIP containing only the needed files for the extension and/or a .CRX file with instructions on how to load the extension into your browser. The proof that the extension was published and, when approved, the store links, should be present somewhere in the project repo.

</details>

<details>

<summary>Bots (Discord, Slack)</summary>

1. Must have a functional invite link with proper scopes for the bot for users to add to their own servers
2. Must have an invite link to a test server or channel where users can see the bot functioning

Notes:

* If the submitter is unable to host the bot themselves **due to external cost only** ("this integral API costs me 1c/call," not "I don't feel like figuring out Nest"), they can instead include **detailed self-host instructions**, preferably with a single script that takes care of most of the setup

</details>

<details>

<summary>Mods/plugins</summary>

1. Must be fully published to the respective platform's mod hosting site (Modrinth, Curseforge, Steam Workshop, VS Code Extensions Store, etc.)

Notes:

* If and only if the platform the user is publishing to **requires a publishing fee**, the user can instead include a build of the mod or plugin and detailed instructions on how to load/sideload it

</details>

<details>

<summary>Contributions (e.g., Pull Requests)</summary>

1. Must include a link to the contribution/pull request (open or merged)
2. Must include a live link to the project the user contributed to
   1. If applicable, this must be the link to the specific part of the project the user contributed to (e.g., a subpage)
3. Must include a description of what the contribution added or changed (in the pull request itself or otherwise prominent in the ship)

</details>

### Hardware

<table><thead><tr><th width="313">Component</th><th width="199">Required If</th><th>Notes</th></tr></thead><tbody><tr><td><p>A BOM with:</p><ol><li>All components used in the project (regardless of whether the submitter already owns them)</li><li>Specific part names (e.g., "Seeed Studio XIAO RP2040," not "Microcontroller")</li></ol></td><td>Always required, unless the project is 3D model/print only</td><td></td></tr><tr><td>A schematic and all PCB project files</td><td>The project uses a PCB</td><td>For KiCad: .kicad_pro, .kicad_sch, .kicad_pcb</td></tr><tr><td>A wiring diagram</td><td>The project has electronic components but does not have a PCB/schematic (or if there are additional components not included on the PCB)</td><td></td></tr><tr><td>3D models in a modifiable format</td><td>The project includes a 3D printed component (like a case)</td><td>.STEP, .STP, .F3D, etc. — they can include meshes like .STL, but they need .STEP/etc. in addition</td></tr><tr><td>Firmware</td><td>The project needs firmware to accomplish its primary purpose (most projects with microcontrollers)</td><td>The firmware doesn't need to be tested and can be basic if the project is in the design phase</td></tr></tbody></table>

***

### Disallowed Hosts (and what to use instead)

#### Web hosts

**Disallowed**

* Streamlit

**Use Instead**

* Nest
* Railway
* Render
* Vercel

#### Demo videos

**Disallowed**

* Google Drive
* Uncommon downloadable video formats
  * Ex. Proprietary formats that aren't playable on some devices/require conversion

**Use Instead**

* YouTube
* Vimeo
* Hosted/downloadable .mp4 file via #cdn (preferred) or on GitHub


---

---

# Override Hours Spent

The **Override Hours Spent** field records the number of hours being approved for this project. Once the project is entered into the YSWS unified database, the project author is responsible for ensuring that this number accurately reflects the actual work invested in the project.

The approved hours should represent the *genuine effort* put into building the project. Reviewers may **deflate** (reduce) the approved hours when there is evidence that the claimed hours do not reflect reality.

## Project Updates

If you are submitting a project update, submit **only the hours tracked since the last update** (not the total amount of hours).

## Default to Deflation

{% hint style="warning" %}
When a reviewer has doubts about the accuracy of the claimed hours, the correct response is to **deflate aggressively**. The unified database must reflect hours that we are confident are real. It is far better to under-approve hours than to let inflated hours into the database.

**When in doubt, deflate.** If the evidence does not clearly support the claimed hours, reduce them to a number that the evidence *does* support. Do not give submitters the benefit of the doubt on hours; give them the benefit of the doubt on intent, but not on the number.
{% endhint %}

## Outright Fraud

Submissions that show clear signs of fraud (fabricated Hackatime data, plagiarized projects, fake commit histories, or other deliberate deception) should **not** be entered into the database at all. The unified database is not a holding pen for suspicious records. If a submission is fraudulent, reject it outright. Do not deflate it to zero; simply do not create a record for it.

Examples of outright fraud include:

* Hackatime data that is clearly fabricated (e.g. heartbeats generated by a script rather than actual coding activity).
* A project copied from another source and submitted as original work.
* A commit history that was manufactured after the fact to simulate incremental progress.
* Any deliberate attempt to deceive the review process.

## Reason for Deflation 1: Inflated Hours

The claimed hours must be proportional to the complexity and scope of the project. A simple HTML page with no CSS, for example, cannot reasonably account for 10 hours of work.

This is **not** meant to penalize beginners. Different people learn at different speeds, and time spent learning counts as legitimate effort. A beginner who takes longer to build the same project as an experienced developer is perfectly fine.

However, deflation is warranted when the following signs appear together:

* The repository lacks commits showing incremental progress.
* Hackatime heartbeats exhibit patterns consistent with fraud (e.g. writing script).
* The project's complexity does not align with the hours claimed.

When these indicators converge, it suggests the submitter is not a beginner but someone intentionally inflating their hours. In such cases, the reviewer should deflate the approved hours to a number that reasonably reflects the actual work done.

## Reason for Deflation 2: AI-Generated Code

AI tools are a valuable part of modern development and their use is permitted. Projects built with AI assistance (including projects where the code is largely or entirely AI-generated) can be valid YSWS submissions, as long as the submitter put in genuine effort, the project actually works, and the submitter learned something in the process.

The key question is not "how much of the code did AI write?" but rather "how much genuine effort did the submitter invest?"

The following rules apply:

* **AI slop is not eligible.** A project that was generated in a single prompt with no meaningful iteration, testing, or refinement is not a real project. If the submitter did not engage with the output (did not debug it, did not shape it, did not learn from it), then there is no genuine effort to reward. Reject these submissions outright.
* **When in doubt, deflate.** If it is unclear how much genuine effort went into an AI-assisted project, deflate the hours to reflect only what you are confident the submitter actually did. The same "default to deflation" principle from above applies here.
* Individual YSWS programs may define **stricter** AI usage criteria than the ones described here, but they may **not** be more relaxed.

## Art and Asset Creation

Time spent on art and asset creation (e.g. sprites, 3D models, sound design, level design) may be counted towards the total hours if the assets are part of the **core project**. For example, custom assets made for a video game would qualify. However, art and asset hours must not represent more than **25%** (one quarter) of the total approved hour count.


---

---

# Override Hours Spent Justification

The **Override Hours Spent Justification** field must provide supporting evidence for the approved hour count. The standard is simple: **someone who was not involved in the review should be able to read this justification, follow the links, and reach the same conclusion you did.**

This means the justification must contain *specific, verifiable* information, including links, numbers, and concrete observations. If your justification does not point to anything that another person could go check for themselves, it is not sufficient.

This field is **not public-facing**. The submitter will not see what you write here. It is an internal record intended for other reviewers and for auditing purposes. Because of this, the justification should be written as a factual explanation of the evidence you examined and the conclusion you reached. It is not the place for encouragement, or commentary directed at the submitter.

In the YSWS Projects Submission component, for convenience, **there are several fields that are combined into the Override Hours Spent Justification field in the Unified Database**. Some of these can be omitted depending on your YSWS and submission type.

### For Smaller YSWS Using the Airtable Directly

Fill out the [Justification Fields](#justification-fields) in the Airtable that are applicable to your submission — that's all you need for your justification. Don't put anything in the Optional - Override Hours Spent Justification field. The automation will combine your fields into the justification field in the Unified Database.

### For Larger YSWS with Custom Review Flows

You can fill out the [Justification Fields](#justification-fields) one-by-one, but it's probably easier to put your filled-out custom template in Optional - Override Hours Spent Justification, which overrides the individual fields — just make sure that each element you need to include per the [Justification Fields](#justification-fields) is present in your templated justification.&#x20;

## Justification Fields

<table><thead><tr><th width="228">Field</th><th>Description</th><th>Include When</th></tr></thead><tbody><tr><td>Hackatime Project Name(s) and Date Range(s)</td><td>Hackatime project names associated with the submission along with the dates they were analyzed over (see <a href="#hackatime-project-name-s-and-date-range-s">below</a>). Can/should be automated.</td><td>Using Hackatime to track hours</td></tr><tr><td>Submitter Hackatime ID</td><td>Submitter's numeric Hackatime ID. Can/should be automated.</td><td>Using Hackatime to track hours</td></tr><tr><td>Lapse Link(s)</td><td>Links to any timelapses associated with the submission. Comma-separated. Can/should be automated.<br><br>(coding Lapses only) Each Lapse should have a short explanation/justification of how much time in the Lapse was on-task and what deflation was applied as a result</td><td>Using Lapse to track hours</td></tr><tr><td>Specific Technical Features</td><td>Features that the project has that justifies the number of hours spent on it (see <a href="#specific-technical-features">below</a>). Should be human-written.</td><td>Always required (unless you have received an exception)</td></tr><tr><td>Deflation Justification</td><td>Explanation of why hours were deflated if they were deflated from what was originally claimed (see <a href="#deflation-justification">below</a>). Should be human-written.</td><td>The time tracked on the project was deflated by the reviewer</td></tr><tr><td>Alternate Tracking Method</td><td>Explanation of how you determined hours if you did not only use Hackatime/Lapse (see <a href="#alternate-tracking-method">below</a>). The explanation of how your time-tracking works can be automated; if there is some subjectivity to it (e.g., self-reported), also include a human-written explanation of why you feel the submitted hours are reasonable.</td><td>You are tracking time using something other than Hackatime or Lapse</td></tr><tr><td>Additional Justification</td><td>Additional information you want to convey to the spot-checker that doesn't fit in the other fields. Can be automated (e.g., extra review links), human-written (e.g., personal testimony), or a mix of both.</td><td><p>Other fields may not be sufficient to justify the number of hours, or the submission requires additional context to be fairly reviewed (see <a href="#additional-justification">Additional Justification</a>)</p><p><br>You want to include additional links with more evidence (ex. the project page on a custom YSWS review platform)</p></td></tr></tbody></table>

### Hackatime Project Name(s) and Date Range(s)

The **Hackatime Project Name(s) and Date Range(s)** field should specify 1) what Hackatime projects were looked at when calculating hours for this project and 2) the days over which the hours were counted. For example, a project update should include only dates after the previous update was submitted.

This field should be formatted as a comma-separated list.&#x20;

Example: For hackatime-project tracked from 7/20/2026 to 7/22/2026 and hackatime-project-2 tracked from 7/21/2026 to 7/23/2026, write as:

`hackatime-project 7/20/2026-7/22/2026, hackatime-project-2 7/21/2026-7/23/2026`

### Specific Technical Features

The **Specific Technical Features** justification field should detail what qualities the project has that explains the number of hours the user spent on it. This should be as specific as possible and not just a list of the languages used.

| Project Type                     | Good Example                                                                      | Bad Example                                      |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Godot game                       | "realtime multiplayer, procedurally-generated worlds, cloud saving"               | "fun and unique game, has lots of pretty assets" |
| Web app                          | "OAuth authentication, full REST API, self-hosted Postgres database"              | "React"                                          |
| Hardware project                 | "USB-C battery charging with discharge management, custom case designed with CAD" | "super cool project, very polished"              |
| Simple portfolio site (beginner) | "multiple pages, CSS features like flexbox and animations, custom onclick script" | "HTML, CSS, JS"                                  |

### Alternate Tracking Method

Your justification should include a brief explanation of what method you used (ex. self-reported by user, base amount for project of this type, in-house YSWS-specific tracker) and why you are confident that the number of hours submitted (after deflation, if applicable) are accurate according to your method.

### Deflation Justification

**If the submitted hours are deflated from the number of hours tracked, you should include:**&#x20;

1. **the number of hours they were deflated to**, and
2. **why you deflated them** (i.e., why submitter experience doesn't match with technical features<sup>1</sup> or why evidence does not support the amount of time claimed)

Some examples of deflation justifications are:

* Ex. "Deflated from 10 hours to 2.5 hours because site contains only basic HTML/CSS/JS, user has created websites before, and UI was clearly created with AI"
* Ex. "Deflated from 8 hours to 4 hours because journal entries overstate design and build time for an experienced hardware builder"
* Ex. "Deflated from 7 hours to 4 hours because only 3 commits with code changes were made"

<sup>1</sup>If technical features far exceed submitter experience, consider if AI was used in a way not conducive to learning, which would warrant hour deflation. If user experience far exceeds technical features, consider how many hours it reasonably should have taken for the submitter to create the project or how many hours of genuine effort likely went into it, and then deflate to that amount of hours.

### Additional Justification

If the submission has one or more suspicious characteristics, more information may be required for a secondary reviewer or spot-checker to be confident in your assessment. Suspicious qualities include (but aren't limited to):

* The project has **very few significant** (i.e., not README updates or very minor changes) **commits** in comparison to the number of hours
* The project **heartbeats on Hackatime show suspicious/fraudulent patterns** (very long coding sessions, rods to god, etc.)
* The project contains a **high percentage of AI-written code** in comparison to the number of hours spent and number of significant commits (ex. only one commit which includes code with lots of AI signifiers)

If you submit a project with suspicious characteristics without sufficient justification, it may be subject to a fine when spot-checked. So, even if you aren't completely sure about a project being suspicious, it's a good idea to include extra justification just in case.

Some examples of elements you can include in additional justification are:

1. Submitter experience in project field with evidence
   * Ex. "beginner - this is their first hardware project per GitHub repos"
   * Ex. "advanced - they have completed multiple HTML/CSS/JS websites in the past per GitHub repos"
   * Ex. "beginner - they don't use Python conventions or advanced methods in their code"
2. Why submitter experience matches technical features
   * Ex. "No adjustment to the hours tracked was made because 15 hours is typical for a hardware beginner making their first macropad"

## What does not pass

The following are examples of justifications that fail this standard:

* "Hackatime checks out." (Checks out how? No project name, no date range, no numbers, nothing for anyone else to verify.)
* "Looks like a solid project, approving 10 hours." (What made it look solid? No evidence cited.)
* A bare Hackatime project name with no summary or analysis. (The name alone does not explain what the reviewer actually looked at or concluded.)
* "Good job :)" or "Great project, approved!" (The justification field is not for feedback or encouragement. It is an internal evidence record, not a message to the submitter.)


---

---

# Spot-Checks

### Spot-check Verdicts

These are the possible verdicts you can receive for a spot-check:

1. <mark style="color:$success;">Accepted</mark> - The project requires no changes and remains in the Unified Database
2. <mark style="color:$warning;">Needs Changes (fine issued)</mark> - The project does not qualify for submission into the Unified Database in its current state, but **it can be resubmitted after changes are made**
3. <mark style="color:$danger;">Rejected (fine issued)</mark> - The project cannot qualify for submission into the Unified Database even if changes are made and **should not be resubmitted**

Reasons a project can receive a certain verdict include, but are not limited to, the following:

<table><thead><tr><th width="48">#</th><th width="169">Verdict</th><th>Criteria</th></tr></thead><tbody><tr><td>1</td><td><mark style="color:$danger;">Rejected</mark></td><td>Project is a duplicate and is not a team project, update, or approved cross-program submission</td></tr><tr><td>2</td><td><mark style="color:$danger;">Rejected</mark></td><td>Project is the result of fraud (Hackatime hour inflation, skirting program-specific rules, etc.)</td></tr><tr><td>3</td><td><mark style="color:$danger;">Rejected</mark></td><td>Project is plagiarized from another source (tutorial with no modifications, stolen code, copy of a previous project with little/no modifications, etc.)</td></tr><tr><td>4</td><td><mark style="color:$danger;">Rejected</mark></td><td>Project was made for a school assignment</td></tr><tr><td>5</td><td><mark style="color:$danger;">Rejected</mark></td><td>Project was built as part of Hack Club employment or other paid Hack Club work (doesn't count personal projects made during unpaid time while employed by Hack Club)</td></tr><tr><td>6</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Project does not work as described by the submitter (ex. project description claims Google OAuth support but no option is shown during login)</td></tr><tr><td>7</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Submitted project does not match the reviewer justification (ex. hour mismatch, feature mismatch, Hackatime project mismatch)</td></tr><tr><td>8</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>One or more required fields are missing/blank (see <a href="/pages/fe0ca5c654608ed5288a55cc59307dde395586d8">Required Fields</a>)</td></tr><tr><td>9</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Screenshot does not represent the project (see <a href="/pages/fe0ca5c654608ed5288a55cc59307dde395586d8#screenshot">Screenshot</a>)</td></tr><tr><td>10</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Playable URL is broken or not able to be publicly experienced (see <a href="/pages/fe0ca5c654608ed5288a55cc59307dde395586d8#playable-url">Playable URL</a>)</td></tr><tr><td>11</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Code URL is broken or not publicly accessible (see <a href="/pages/fe0ca5c654608ed5288a55cc59307dde395586d8#code-url">Code URL</a>)</td></tr><tr><td>12</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Project is not reproducible (see <a href="/pages/fe0ca5c654608ed5288a55cc59307dde395586d8">Reproducibility</a>)</td></tr><tr><td>13</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Project is a duplicate and is part of a team project, update, or approved cross-program submission, BUT reasoning for it being a duplicate is not present in reviewer justification (see <a href="/pages/4d848e8aa2e9cec1a4045c12da332ab3c982a029">Duplicate and Updated Submissions</a>)</td></tr><tr><td>14</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Reviewer justification does not contain all required elements/is insufficient to justify hours submitted (see <a href="/pages/5ca35ed71b38d496319fe88e62453c16c78f39f9">Override Hours Spent Justification</a>)</td></tr><tr><td>15</td><td><mark style="color:$warning;">Needs Changes</mark></td><td>Required evidence (ex. Hackatime projects) cannot be located using the information provided (see <a href="/pages/5ca35ed71b38d496319fe88e62453c16c78f39f9">Override Hours Spent Justification</a>)</td></tr></tbody></table>

#### Disputing verdicts

Spot-checkers make mistakes, too! If you think a fine was issued by mistake, please don't hesitate to reach out and raise a dispute. To have the best chance of a fine being reversed, keep in mind that:

* You must prove, with evidence, that **the criteria were not met and the spot-checker made a mistake** (e.g., the screenshot does match the project but it's in dark mode so it looks significantly different).
* You cannot dispute by providing an excuse after the submission (e.g., there is no screenshot because the submitter's dog ate their Print Screen button) -- **the issue should have been resolved before submission to the Unified Database** by either coordinating with the submitter or reaching out to the spot-checker.

#### Resubmitting Projects

If your project is marked as "Needs Changes" or "Rejected", **it is removed from the Unified Database**. **"Needs Changes" projects can be resubmitted** to the Unified Database (becoming eligible for payout again) by making the necessary changes and then clicking the "Automation - Submit to Unified YSWS" again in your program Airtable. **"Rejected" projects should not be resubmitted** to the Unified Database even with changes unless you have received permission from a spot-checker.


---

---

# Duplicate and Updated Submissions

Authors are permitted to submit a project to the YSWS unified database more than once if the project has received a meaningful update since its last submission. For example, a portfolio website that has been revamped.

## What is not allowed

Submitting the **same work with the same hours** to multiple programs and having both entries approved in the database is **not permitted**. Each record in the unified database must represent a distinct block of effort.

## Attribution

The first program to approve a project into the unified database gets attribution for that project.

## Same-program updates

If a project that was already submitted to your program receives an update, create a new record for the update. The new record must only approve hours for the new work, not for the hours that were already approved in the original record. The justification for the new record must:

1. Explicitly state that this is an update to a project previously submitted to the same program.
2. Reference how many hours were previously approved.
3. Describe what the update consists of.
4. Approve only the hours corresponding to the new work.

For example: “This project was previously approved for 10 hours in this program. The submitter has since added a multiplayer mode and 3 new levels. Approving 4 hours for the update.”

## Cross-program updates

If you are receiving an updated version of a project that was originally submitted through a **different** YSWS program, you should create a **new record** in the database. The new record must only approve hours for the *new work*. Hours that were already approved under the original program's record must not be included again.


---

---

# Project Exceptions

Some projects cannot be submitted to the YSWS unified database, even if they otherwise meet the normal submission requirements.

## Paid Hack Club work

Projects built as part of Hack Club employment or other paid Hack Club work cannot be submitted to the unified database.

This only applies to the paid work itself. Personal projects built on your own unpaid time can still be submitted.

## School Assignments

Projects made as a part of a school assignment cannot be submitted to the unified database.


---
