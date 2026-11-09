import { t, useLanguage } from '../i18n';
import { formatReleaseDate, RELEASE, releaseCommitUrl } from '../release';
import './release-info.css';

export function ReleaseInfo({compact=false}:{compact?:boolean}) {
  const {language}=useLanguage();
  const href=releaseCommitUrl(RELEASE),date=RELEASE.committedAt&&formatReleaseDate(RELEASE.committedAt,language);
  const label=RELEASE.dirty?t('Helyi, nem végleges változat'):RELEASE.development?t('Forráscommit · helyi fejlesztés'):t('Szoftver utolsó frissítése');
  return <span className={`release-info${compact?' compact':''}`} data-commit={RELEASE.commit??''} data-committed-at={RELEASE.committedAt??''} data-dirty={String(RELEASE.dirty)} data-development={String(RELEASE.development)}>
    <span className="release-label">{label}{!RELEASE.dirty&&date?':':''}</span>
    {date&&!RELEASE.dirty&&(href?<a href={href} target="_blank" rel="noopener noreferrer" title={t('A megjelenített verzió GitHub-commitja: {commit}',{commit:RELEASE.commit!})}><time dateTime={RELEASE.committedAt!}>{date}</time></a>:<time dateTime={RELEASE.committedAt!}>{date}</time>)}
    {!date&&!RELEASE.dirty&&<span>{t('A commitadat nem érhető el.')}</span>}
  </span>;
}
