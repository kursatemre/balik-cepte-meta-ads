# Kreatifler (yerel)

Reklam görsellerini buraya koy. Hiçbir dış servise (AdWhispr Creative Library
dahil) bağımlı değiliz — `cli.py campaign create --images ...` bu klasördeki
dosyaların yolunu bekler.

Bu klasörün kendisi git'e commit edilir (bu README ile), ama içine attığın
görseller `.gitignore` ile hariç tutulur — repo'ya yanlışlıkla büyük binary
dosya girmez.

## Kullanım

Görselleri buraya at (`kart1.jpg`, `kart2.png`, ...), sonra:

```bash
python cli.py campaign create \
  --images creatives/kart1.jpg creatives/kart2.jpg creatives/kart3.jpg \
  --headlines "Başlık 1" "Başlık 2" "Başlık 3" \
  ...
```

Sıra önemli: ilk `--images` yolu ilk `--headlines` metniyle eşleşir (carousel
kart sırası).
