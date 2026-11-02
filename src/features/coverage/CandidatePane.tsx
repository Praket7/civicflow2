import { AlertTriangle, ArrowRight, ChevronDown } from "lucide-react";
import { Avatar, Badge, Button, SearchField } from "../../components/ui";
import { t } from "../../lib/i18n";
import styles from "./AutoRosterPage.module.css";
import type { AutoRosterModel } from "./useAutoRoster";

export function CandidatePane({
  scope,
  data,
  query,
  setQuery,
  skillFilter,
  setSkillFilter,
  availabilityFilter,
  setAvailabilityFilter,
  sortBy,
  setSortBy,
  skillOptions,
  filteredCandidates,
  visibleCandidates,
  showAll,
  setShowAll,
}: AutoRosterModel) {
  return (
    <section className={`${styles.pane} ${styles.available}`} aria-label="Available volunteers">
      <div className={styles.paneHead}>
        <div>
          <h2 className={styles.paneTitle}>Who can take it</h2>
          <p className={styles.paneSub}>
            {data.candidates.length} people match at least one open role
            {scope === "week" ? " this week" : ""}.
          </p>
        </div>
        <span className={styles.paneCount}>
          <strong>{filteredCandidates.length}</strong> shown
        </span>
      </div>

      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search by name or skill"
        label="Search eligible volunteers"
      />

      <div className={styles.filters}>
        <label className={styles.selectWrap}>
          <span className={styles.srOnly}>Filter by role</span>
          <select value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)}>
            <option value="all">All Skills</option>
            {skillOptions.map((skill) => (
              <option key={skill} value={skill}>
                {skill}
              </option>
            ))}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <label className={styles.selectWrap}>
          <span className={styles.srOnly}>Filter by availability</span>
          <select
            value={availabilityFilter}
            onChange={(event) => setAvailabilityFilter(event.target.value)}
          >
            <option value="all">All Availability</option>
            <option value="available">Available</option>
            <option value="partial">Partial</option>
            <option value="unknown">Not confirmed</option>
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <label className={styles.selectWrap}>
          <span className={styles.srOnly}>Sort volunteers</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            <option value="best">Sort: Best Match</option>
            <option value="attendance">Sort: Attendance</option>
            <option value="name">Sort: Name</option>
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
      </div>

      <ul className={styles.candidateList}>
        {visibleCandidates.map((candidate) => (
          <li key={candidate.volunteer.id} className={styles.candidate}>
            <Avatar
              initials={candidate.volunteer.initials}
              src={candidate.volunteer.photo}
              tone={candidate.volunteer.tone}
              size={38}
              label={candidate.volunteer.name}
            />
            <div className={styles.candidateBody}>
              <div className={styles.candidateTop}>
                <span className={styles.candidateName}>{candidate.volunteer.name}</span>
                <span className={styles.matchScore} aria-label={`${candidate.score} percent match`}>
                  {candidate.score}%
                  <ArrowRight size={12} aria-hidden="true" />
                </span>
              </div>
              <div className={styles.candidateMeta}>
                {candidate.primaryRole} · {candidate.volunteer.attendanceRate}% attendance
              </div>
              <div className={styles.candidateTags}>
                {Array.from(new Set([...candidate.eligibleRoles, ...candidate.volunteer.skills]))
                  .slice(0, 2)
                  .map((role) => (
                    <span key={role} className={styles.skillTag}>
                      {role}
                    </span>
                  ))}
              </div>
              {candidate.conflict || candidate.waitlisted ? (
                <div className={styles.candidateFlags}>
                  {candidate.waitlisted ? <Badge tone="violet">Waitlist</Badge> : null}
                  {candidate.conflict ? (
                    <Badge tone="amber" icon={<AlertTriangle size={9} />}>
                      Conflict
                    </Badge>
                  ) : null}
                </div>
              ) : null}
              <details className={styles.why}>
                <summary>Why this match</summary>
                <ul className={styles.reasonList}>
                  {candidate.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className={styles.breakdown}>
                  {candidate.breakdown.map((row) => (
                    <div key={row.label} className={styles.breakdownRow}>
                      <span>{row.label}</span>
                      <div className={styles.breakdownTrack} aria-hidden="true">
                        <span
                          style={{
                            width: `${row.max === 0 ? 0 : Math.min(100, (row.value / row.max) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className={styles.breakdownValue}>{row.value}</span>
                    </div>
                  ))}
                </div>
                <p className={styles.whyNote}>
                  {t(
                    candidate.weeklyShifts === 1
                      ? "{count} upcoming shift in this window"
                      : "{count} upcoming shifts in this window",
                    { count: candidate.weeklyShifts },
                  )}
                  {candidate.conflict ? ` ${candidate.conflict}` : ""}
                </p>
              </details>
            </div>
          </li>
        ))}
      </ul>

      {filteredCandidates.length === 0 ? (
        <p className={styles.none}>No volunteer matches that search.</p>
      ) : filteredCandidates.length > 6 ? (
        <Button
          variant="ghost"
          size="small"
          className={styles.showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? t("Show fewer") : t("Show all {count}", { count: filteredCandidates.length })}
        </Button>
      ) : null}
    </section>
  );
}
