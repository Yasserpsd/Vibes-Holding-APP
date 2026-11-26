/**
 * M284: the server's two-letter country codes → the ISO 3166 numeric ids of the world-atlas map shapes.
 * Kosovo has no numeric id in the map, so it is matched by its English name instead.
 */
const PAIRS =
  'sa682 ae784 kw414 qa634 bh048 om512 eg818 jo400 lb422 sy760 iq368 ps275 ye887 ly434 tn788 dz012 ma504 sd729 so706 mr478 ' +
  'dj262 km174 is352 et231 az031 am051 er232 es724 au036 ee233 sz748 cf140 af004 ar032 ec218 al008 bs044 br076 pt620 ba070 ' +
  'cz203 me499 dk208 do214 cv132 sv222 sn686 se752 cn156 ga266 va336 ph608 cm120 cg178 cd180 mv462 de276 hu348 mx484 no578 ' +
  'at040 ne562 in356 us840 jp392 gr300 ag028 ad020 id360 ao024 uy858 uz860 ug800 ua804 ir364 ie372 it380 pg598 py600 bb052 ' +
  'pk586 pw585 bn096 gb826 be056 bg100 bz084 bd050 pa591 bj204 bt064 bw072 bf854 bi108 pl616 bo068 pe604 by112 th764 tw158 ' +
  'tm795 tr792 tt780 td148 cl152 tz834 tg768 tv798 to776 tl626 jm388 sb090 mh584 za710 ss728 ge268 dm212 rw646 ru643 ro642 ' +
  'zm894 zw716 ci384 ws882 sm674 vc670 kn659 lc662 st678 lk144 sk703 si705 sg702 sr740 ch756 sl694 sc690 rs688 tj762 gm270 ' +
  'gh288 gd308 gt320 gy328 gn324 gq226 gw624 vu548 fr250 ve862 fi246 vn704 fj242 cy196 kg417 kz398 hr191 kh116 ca124 cu192 ' +
  'kr410 kp408 cr188 co170 ki296 ke404 lv428 la418 lu442 lr430 lt440 li438 ls426 mo446 mw454 mt470 ml466 my458 mg450 mk807 ' +
  'mn496 mu480 mz508 md498 mc492 mm104 fm583 na516 nr520 np524 ng566 ni558 nz554 ht332 hn340 nl528 hk344';

/** numeric id (as the map writes it, «004») → two-letter code. */
export const CODE_BY_NUMERIC: ReadonlyMap<string, string> = new Map(PAIRS.split(' ').map((pair) => [pair.slice(2), pair.slice(0, 2)]));

/** Map shapes without a numeric id that still belong to a country of the list. */
export const CODE_BY_NAME: Readonly<Record<string, string>> = { Kosovo: 'xk' };
