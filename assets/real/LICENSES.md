# Real-look textures: sources and licenses

All from Poly Haven (https://polyhaven.com), **CC0 1.0** (public domain, no attribution required; credited here). Downloaded 2026-10-16 at 1k (textures) and 2k (sky) through https://api.polyhaven.com/files/<asset>. Used by src/client/real.ts (data/look.json → real.detail, real.sky).

| file | asset | sha256 (after the metadata strip, below) |
|---|---|---|
| asphalt_02_diffuse.jpg | https://polyhaven.com/a/asphalt_02 | 1aa5ce99f58a625c… |
| asphalt_02_nor_gl.jpg | https://polyhaven.com/a/asphalt_02 | 42a1c381b53204e8… |
| asphalt_02_rough.jpg | https://polyhaven.com/a/asphalt_02 | 70ba3edc65525eb4… |
| bark_brown_02_diffuse.jpg | https://polyhaven.com/a/bark_brown_02 | 920fa0bed0c9d78c… |
| bark_brown_02_nor_gl.jpg | https://polyhaven.com/a/bark_brown_02 | 0d5e691e8ad8bcd0… |
| bark_brown_02_rough.jpg | https://polyhaven.com/a/bark_brown_02 | 68125592de36e15b… |
| concrete_floor_worn_001_diffuse.jpg | https://polyhaven.com/a/concrete_floor_worn_001 | 2b57d35647040e32… |
| concrete_floor_worn_001_nor_gl.jpg | https://polyhaven.com/a/concrete_floor_worn_001 | bb2b2cc12d6db77e… |
| concrete_floor_worn_001_rough.jpg | https://polyhaven.com/a/concrete_floor_worn_001 | 5f69f6d9f942f4e0… |
| concrete_wall_008_diffuse.jpg | https://polyhaven.com/a/concrete_wall_008 | c5a0177d16533eb6… |
| concrete_wall_008_nor_gl.jpg | https://polyhaven.com/a/concrete_wall_008 | 28f30b2978337042… |
| concrete_wall_008_rough.jpg | https://polyhaven.com/a/concrete_wall_008 | 58df099d830a43fc… |
| rusty_metal_02_diffuse.jpg | https://polyhaven.com/a/rusty_metal_02 | adaf094391518b6a… |
| rusty_metal_02_nor_gl.jpg | https://polyhaven.com/a/rusty_metal_02 | 995197a62cac6fbb… |
| rusty_metal_02_rough.jpg | https://polyhaven.com/a/rusty_metal_02 | 178deb5896232f04… |
| overcast_soil_puresky_2k.hdr | https://polyhaven.com/a/overcast_soil_puresky | 5414e1ac0c35e451… |

The six concrete files carried Photoshop EXIF and IPTC blocks as downloaded; a lossless strip (src/harness/imagemeta.ts) removed them (the decoded pixels are unchanged) on 2026-11-16, so their hashes differ from the downloads.
