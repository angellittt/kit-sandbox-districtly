<!--
CONTEXT.md template.

This is a glossary for THIS project's domain — not a generic doc. Fill it in
as terms and decisions get resolved (a good trigger: the same concept gets
described two different ways in two different PRs). Keep it short enough
that people actually read it; split out a package-specific glossary only if
that package grows a genuinely separate vocabulary worth tracking on its own.

Delete this comment block once the project has real content below.
-->

# <Project name>

<!-- One or two sentences: what this product is, who uses it, what it's for. -->

## Language

<!--
One entry per domain term that isn't self-explanatory from its name alone,
or that's easy to confuse with a near-synonym. Skip terms that are just
plain English with no project-specific meaning.

Format per term:

**<Term>**:
<What it means in this codebase — the definition a new engineer or an AI
agent needs to use the term correctly, including relevant field names,
states, or invariants.>
_Avoid_: <synonyms this project deliberately does not use for this concept,
and why, if it's not obvious>
-->

## Authentication & Roles

<!--
One entry per role/actor type in the system: what backs it (e.g. a table,
a JWT claim), how it authenticates, and how it differs from adjacent roles.
Only needed once the project has more than one role or a non-obvious auth
flow — skip this section entirely until then.
-->

## Relationships

<!--
Bullet list of how the core domain entities relate to each other — the
facts a data model diagram would show, in prose. e.g.:
- A **<Entity>** belongs to one **<Other Entity>**
- A **<Entity>** has one **<Other Entity>** per **<Third Entity>**
-->

## Example dialogue

<!--
One or two short Q&A exchanges between a developer and a domain expert,
showing the glossary's terms used correctly in context. Helps a reader (or
an agent) calibrate tone and precision, not just definitions.

> **Dev:** "<question using project terms>"
> **Domain expert:** "<answer using project terms>"
-->
