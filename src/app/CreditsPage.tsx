import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { OPEN_SOURCE_CREDITS } from "../data/credits";
import thirdParty from "../data/thirdParty.json";
import styles from "./CreditsPage.module.css";

/** Group packages by the license they declare, newest metadata first. */
function byLicense(packages: { name: string; version: string; license: string }[]) {
  const groups = new Map<string, string[]>();
  for (const item of packages) {
    const key = item.license.split(" OR ")[0].split(" AND ")[0];
    const list = groups.get(key) ?? [];
    list.push(`${item.name} ${item.version}`);
    groups.set(key, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const javascriptLicenses = byLicense(thirdParty.npm);
const rustLicenses = byLicense(thirdParty.cargo);
const directCount =
  thirdParty.npm.filter((item) => item.direct).length +
  thirdParty.cargo.filter((item) => item.direct).length;

export function CreditsPage() {
  // Crops of one photograph are credited once, with all their files.
  const groups = OPEN_SOURCE_CREDITS.photos.reduce<
    { photo: (typeof OPEN_SOURCE_CREDITS.photos)[number]; files: string[]; usage: string[] }[]
  >((rows, photo) => {
    const existing = rows.find((row) => row.photo.sourceUrl === photo.sourceUrl);
    if (existing) {
      existing.files.push(photo.file);
      existing.usage.push(photo.usage);
      return rows;
    }
    rows.push({ photo, files: [photo.file], usage: [photo.usage] });
    return rows;
  }, []);
  const photos = groups.map((group) => ({
    ...group.photo,
    image: group.photo.file,
    file: group.files.join(" · "),
    usage: group.usage.join(" · "),
  }));
  // The header counts bundled files, so it adds up against `public/media`.
  const files = OPEN_SOURCE_CREDITS.photos;
  const pexelsCount = files.filter((photo) => photo.license === "Pexels License").length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>About CivicFlow</p>
        <h1 className={styles.title}>Photo &amp; open-source credits</h1>
        <p className={styles.lede}>
          CivicFlow ships no AI-generated imagery. All {photos.length} bundled photographs are
          free-licensed, and each one is listed below with its source, license, and the screen it
          appears on.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="photo-credits">
        <div className={styles.sectionHead}>
          <h2 id="photo-credits" className={styles.sectionTitle}>
            Photography
          </h2>
          <p className={styles.sectionMeta}>
            {files.length} files · {pexelsCount} Pexels · {files.length - pexelsCount} CC BY-SA 4.0
          </p>
        </div>
        <ul className={styles.grid}>
          {photos.map((photo) => (
            <li key={photo.file} className={styles.photo}>
              <img
                className={styles.thumb}
                src={`/media/${photo.image}`}
                alt=""
                loading="lazy"
                decoding="async"
              />
              <div className={styles.photoBody}>
                <span className={styles.file}>{photo.file}</span>
                <span className={styles.usage}>{photo.usage}</span>
                <span className={styles.meta}>
                  {photo.creator} ·{" "}
                  <a href={photo.sourceUrl} target="_blank" rel="noreferrer">
                    source
                    <ArrowUpRight size={10} aria-hidden="true" />
                  </a>{" "}
                  ·{" "}
                  <a href={photo.licenseUrl} target="_blank" rel="noreferrer">
                    {photo.license}
                  </a>
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.note}>
          Pexels photographs are used under the Pexels License (attribution not required). Crops
          made for layout are adaptations; CC BY-SA 4.0 images stay under that license and are
          credited above. The portrait files are square center crops of the listed Pexels photos.
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="font-credits">
        <h2 id="font-credits" className={styles.sectionTitle}>
          Fonts
        </h2>
        <p className={styles.note}>
          Geist, Geist Mono, and Source Serif 4 are bundled under the SIL Open Font License 1.1. The
          full license text ships at <code>public/licenses/OFL-1.1.txt</code>.
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="software-credits">
        <div className={styles.sectionHead}>
          <h2 id="software-credits" className={styles.sectionTitle}>
            Software
          </h2>
          <p className={styles.sectionMeta}>
            {thirdParty.npm.length} npm packages · {thirdParty.cargo.length} crates · {directCount}{" "}
            direct
          </p>
        </div>
        <p className={styles.note}>
          CivicFlow is released under the MIT License. Every package below is listed with the
          license it declares; the generated notice in <code>THIRD_PARTY_NOTICES.md</code> adds the
          reason each direct dependency is in the build. SQLCipher, SQLite, and OpenSSL are linked
          through <code>rusqlite</code> and keep their own licenses.
        </p>
        <div className={styles.licenseColumns}>
          <details className={styles.licenseGroup}>
            <summary>JavaScript packages ({thirdParty.npm.length})</summary>
            {javascriptLicenses.map(([license, names]) => (
              <div key={license} className={styles.licenseRow}>
                <h3 className={styles.licenseName}>{license}</h3>
                <p className={styles.licensePackages}>{names.join(" · ")}</p>
              </div>
            ))}
          </details>
          <details className={styles.licenseGroup}>
            <summary>Rust crates ({thirdParty.cargo.length})</summary>
            {rustLicenses.map(([license, names]) => (
              <div key={license} className={styles.licenseRow}>
                <h3 className={styles.licenseName}>{license}</h3>
                <p className={styles.licensePackages}>{names.join(" · ")}</p>
              </div>
            ))}
          </details>
        </div>
      </section>

      <Link className={styles.back} to="/coordinator/mission-control">
        Back to Mission Control
      </Link>
    </div>
  );
}
