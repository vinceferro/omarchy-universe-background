# Image credits

All imagery here is real data, used under its licence. Thank you to the
observatories, agencies and people who made it free to share.

## Sky

`sky-full.jpg` (and the static sky wallpapers made by
`tools/make_sky_views.py`): **NASA/Goddard Space Flight Center Scientific
Visualization Studio**, *Deep Star Maps 2020* (visualisation by Ernie Wright),
built from Hipparcos-2, Tycho-2 and **Gaia DR2: ESA/Gaia/DPAC**. Public domain
(US government work); credit given as requested.
<https://svs.gsfc.nasa.gov/4851>

## Earth and Moon

`earth-day.jpg`, `earth-night.jpg`: NASA Earth Observatory, Blue Marble and
Black Marble. `moon.jpg`: NASA/GSFC/Arizona State University, Lunar
Reconnaissance Orbiter. Public domain.

## Places (`photos.jpg`, made by `tools/make_atlas.py`)

Each photo is turned north-up, black-levelled and soft-edged; otherwise as published.

| Object | Credit | Licence | Source |
|---|---|---|---|
| Orion Nebula M42 | ESO/Igor Chekalin | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Orion_Nebula_MPG_ESO_2.2-metre_telescope_at_the_La_Silla_Observatory.jpg/3840px-Orion_Nebula_MPG_ESO_2.2-metre_telescope_at_the_La_Silla_Observatory.jpg> |
| Carina Nebula (with Eta Carinae) | ESO. Acknowledgement: VPHAS+ Consortium/Cambridge Astronomical Survey Unit | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/The_spectacular_star-forming_Carina_Nebula_imaged_by_the_VLT_Survey_Telescope.jpg/3840px-The_spectacular_star-forming_Carina_Nebula_imaged_by_the_VLT_Survey_Telescope.jpg> |
| Eagle Nebula M16 | ESO | CC BY 4.0 | <https://cdn.eso.org/images/large/eso0926a.jpg> |
| Lagoon Nebula M8 | ESO/S. Guisard | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/1/16/Lagoon_Nebula_%28ESO%29.jpg> |
| Rosette Nebula | CTIO/NOIRLab/DOE/NSF/AURA; Image processing: T.A. Rector (University of Alaska Anchorage/NSF NOIRLab), D. de Martin & M. Zamani (NSF NOIRLab) | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Rosette_Nebula_Captured_with_DECam_%28noirlab2424a%29.jpg/3840px-Rosette_Nebula_Captured_with_DECam_%28noirlab2424a%29.jpg> |
| Crab Nebula M1 | NASA, ESA, J. Hester and A. Loll (Arizona State University) | Public domain (NASA/Hubble) | <https://upload.wikimedia.org/wikipedia/commons/0/00/Crab_Nebula.jpg> |
| Ring Nebula M57 | NASA, ESA, and C. Robert O'Dell (Vanderbilt University) | Public domain (NASA/Hubble) | <https://upload.wikimedia.org/wikipedia/commons/f/fe/Hubble_image_of_the_Ring_Nebula_%28Messier_57%29.jpg> |
| Helix Nebula NGC 7293 | NASA, NOAO, ESA, the Hubble Helix Nebula Team, M. Meixner (STScI), and T.A. Rector (University of Alaska Anchorage/NSF NOIRLab) | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/The_Helix_Nebula%2C_NGC_7293_%28noao0307a%29.jpg/3840px-The_Helix_Nebula%2C_NGC_7293_%28noao0307a%29.jpg> |
| Pleiades M45 | NOIRLab/NSF/AURA/T.A. Rector (University of Alaska Anchorage), R. Cool (University of Arizona) and WIYN | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/1/1e/M45_Pleiades_%28noao-m45%29.jpg> |
| Omega Centauri | ESO | CC BY 4.0 | <https://cdn.eso.org/images/large/eso0844a.jpg> |
| 47 Tucanae | NOIRLab/NSF/AURA | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/0/04/47_Tucanae%2C_NGC_104_%28noao-02212%29.jpg> |
| Westerlund 1 | ESA/Webb, NASA & CSA, M. Zamani (ESA/Webb), M. G. Guarcello (INAF-OAPA) and the EWOCS team | CC BY 4.0 | <https://cdn.esawebb.org/archives/images/publicationjpg/potm2409a.jpg> |
| Large Magellanic Cloud | ESO | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/LMC_snapped_by_the_ESO_1-metre_Schmidt_telescope.jpg/3840px-LMC_snapped_by_the_ESO_1-metre_Schmidt_telescope.jpg> |
| Small Magellanic Cloud | CTIO/NOIRLab/NSF/AURA/SMASH/D. Nidever (Montana State University); Image processing: Travis Rector (University of Alaska Anchorage), Mahdi Zamani & Davide de Martin | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/5/5e/SMC_-_Noirlab2030b.jpg> |
| Andromeda Galaxy M31 | KPNO/NOIRLab/NSF/AURA/Adam Block | CC BY 4.0 | <https://upload.wikimedia.org/wikipedia/commons/9/98/M31_%28Andromeda_Galaxy%29_%28noao-m31fsqblock%29.jpg> |

## Face-on galaxy maps (made by `tools/deproject_galaxy.py`)

`m31-faceon.jpg` is unfolded from the Andromeda photo above. `m33-faceon.jpg`
is unfolded from this one (shrunk, north-up, black-levelled, foreground stars
filtered out, stretched face-on):

| Object | Credit | Licence | Source |
|---|---|---|---|
| Triangulum Galaxy M33 | ESO (VLT Survey Telescope, eso1424a) | CC BY 4.0 | <https://cdn.eso.org/images/publicationjpg/eso1424a.jpg> (page: <https://www.eso.org/public/images/eso1424a/>) |

Geometry: M33 at 840 kpc (Freedman et al. 2001, ApJ 553, 47), inclination
55.08 deg and major axis PA 201.12 deg (Koch et al. 2018, MNRAS 479, 2505).

## Local Group dwarfs

`lib/dwarfs.js` and `dwarfs.png` (the same table as bytes for the shader; both
made by `tools/gen_dwarfs.py`): positions, distances and structure from
McConnachie 2012, AJ 144, 4, via VizieR (J/AJ/144/4). The Triangulum close-up
`photos/triangulum-galaxy.jpg` is the ESO photo above, north up.

## Galaxy model

`milkyway-young.png`, `milkyway-dust.png` are generated by
`tools/gen_milkyway.py` from published measurements: spiral arms from Reid et
al. 2019 (ApJ 885, 131); bar and bulge from Wegg, Gerhard & Portail 2015 and
Bland-Hawthorn & Gerhard 2016; dust from Drimmel & Spergel 2001.
