Hubsy Timelapse uses AWS infrastructure to create timelapse videos and slideshows from images taken by [Hubsy Cameras](http://hubsy.io).

# Overview

This set of tools was developed for [Hubsy Cameras](http://hubsy.io). They are small automous cams with high resolution sensors, WiFi and cellular connectivity and either battery or solar power supply.

Here is how it all works.

1. Put your hubsy up and point it in the direction of the action
2. Your hubsy will start uploading images to an S3 bucket.
3. A Lambda function is triggered on new image upload
3.a. The image is processed (cropped, resized, exif cleaned up, etc)
3.b. The image is added to the timelapse video and uploaded to YouTube, if want to make it public
4. A rules-based workflow is triggered for further processing
5. A lambda funtion can be called via HTTP to retrive a list of file names for a slideshow given a date/time range
6. A JavaScript slideshow can be embedded into your website to show the last N images

# Image processing with a λ-function

### Set up

The code for the λ-function is located in master branch. Use [???] package from [???] to upload to AWS. Use IAM and S3 policies from this document to configure security and access.

### S3 storage

Cameras upload the original full size images to an S3 bucket. Every camera has its own path within a bucket. The path inside the bucket (object prefix) is configurable.

```
    -bucket
        config.json
        -full
          -cam1
          -cam2
          ...
        -cam1
            config.json
            index.txt
            -exif
            -resized
                -[size name 1]
                    -idx
                        last.txt
                        last100.txt
                        today.txt
                        24hr.txt
                        7days.txt
                        30days.txt
                -[size name 2]
                    -idx
                -[size name 3]
        -cam2
        ...
```

* **bucket name**: can be any name. A λ-function assigned to the bucket will extract the bucket name and the cam prefix from the object name it was given.
* **config.json**: a config file, which can be nested. The deeper level config file overwrites the higher level one.
* **index.txt**: a text file used internally for updating **idx** folder of each size, containing the index of the last 5,000 uploaded images. It will be created automatically by the λ-function.
* **file names**: uploaded file names must follow ISO 8601 + the file type in this format (YYYYMMDDThhmmss.ssss.jpg, e.g. 20160815T170001.050.jpg). The date/time is recorded by the camera at the moment of the image capture. It may be different from the exif data.
* **object properties**: mimetype=image/jpg, http caching=forever
* **full**: the folder for original files. This is where the cameras upload them in the first place. This folder is taken out to the top level to avoid firing the λ-function when resized images are added.
* **idx**: a folder with indexes maintained by the λ-function as simple list of URLs, one per line. Set http caching to expire immediately.
* **exif**: a folder with with exif data files extracted from the originals. The file names must match those of the original file, except the extension (.txt) and the mime type is text/text, http caching=forever
* **resized**: a folder with resized images with the same file names as the original. The images are grouped in subfolders as per the config file. Set http caching=forever

The camera app knows the bucket name, AWS credentials and its name. It will construct the object name in the format: `[bucketname]/full/[cameraname]/[filename].jpg` and send it to S3. The λ-function will be triggered by the upload and will process the file.

Theoretically, there is no need to pre-create the camera folder if the AWS credentials allow for bucket-wide uploads.

The λ-function creates the folders it needs on the fly. There is no need to pre-create them, unless it is required for access control purposes.

#### Bucket policies

The goal is to grant public access to all objects in `resized` folder.

```
{
	"Id": "Hubsy-Public-Access-Policy",
	"Version": "2012-10-17",
	"Statement": [
		{
			"Action": "s3:GetObject",
			"Effect": "Allow",
			"Resource": "arn:aws:s3:::BUCKET-NAME/*/resized/*",
			"Principal": "*"
		}
	]
}
```

The λ-function has its own set of policies. It should be able to read the entire contents of the bucket, but write only into `resized` folder. This policy has to be set in IAM and attached to the role used for the function.

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": "arn:aws:s3:::BUCKET-NAME"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::BUCKET-NAME/*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject"
            ],
            "Resource": [
                "arn:aws:s3:::BUCKET-NAME/*resized*",
                "arn:aws:s3:::BUCKET-NAME/*/exif/*",
                "arn:aws:s3:::BUCKET-NAME/*index.txt"
            ]
        }
    ]
}
```

### Image resizing

Images are resized to multiple smaller sizes as per this section of the config file:

    {
      "exif-retain": ["Orientation", "DateTime", "DateTimeOriginal"],
      "resize": [
        {"folder": "resized/fhd", "width": 1920, "height": 1080, "compression": 50}
        {"folder": "resized/hd", "width": 1080, "height": 720, "compression": 50}
        {"folder": "resized/small", "width": 500, "height": 500, "compression": 50}
      ],
      "crop": {"top": 100, "left": 100,	"width": 300, "height": 300}
    }

* **exif-retain**: list of EXIF tags to be copied to resized images.
* **folder**: folder name for the resized image to be put in, relative to the camera root. It's just an object prefix in the context of S3.
* **width**, **height**: the maximum size in pixels for the image. It may not be proportional to the image which has to fit into this bounding box without cropping.
* **compression** - JPEG compression / quality level, 1 - 100, where 1 is the lowest and 100 is uncompressed.
* **crop** - describes the box that has to be cropped from the original image before resizing.

When a new file is placed into the bucket the λ-function checks if it's a valid jpeg file, parse the name, extract paths, read the config files, crop, resize and save the results. Images are rotated to the set orientation and the exif orientation tag is removed for compatibility.

# Video

Every new image is added to the end of the timelapse video. Frame duration, video size and other parameters are specified in the config file. **Not implemented**


# Slideshow

You can find a sample slideshow page code on https://github.com/hubsy-io/timelapse/blob/gh-pages/index.html or view a demo at https://hubsy-io.github.io/timelapse/.

We used [Swiper](http://idangero.us/swiper) to create a touch friendly slideshow with lazy image loading.

There are a few configurable parameters for this script, but the only required parameter you have to specify is the source of your image file. They are listed in multiple index files. Look inside `resized` directory for `idx` subfolder and choose the suitable index file, e.g. `https://s3.amazonaws.com/[your bucket name]/[your cam name]/resized/sd/idx/last100.txt`

Insert this HTML placeholder wherever you want to see the slideshow:
```html
<div class="swiper-container">
    <div class="swiper-wrapper"></div>
    <!-- Pagination (optional) -->
    <div class="swiper-pagination swiper-pagination-white"></div> 
    <!-- Navigation (optional) -->
    <div class="swiper-button-next swiper-button-white"></div> 
    <div class="swiper-button-prev swiper-button-white"></div>
</div>
```

Insert these scripts anywhere of the page to initialize the slideshow. Make sure you replaced the URL of index file with the one pointing at your images.
```html
<script src="https://code.jquery.com/jquery-1.12.4.min.js" integrity="sha256-ZosEbRLbNQzLpnKIkEdrPv7lOy9C27hHQ+Xp8a4MxAQ=" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.3.1/js/swiper.jquery.min.js"></script>
<script>
  // Loading Swiper stylesheet
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.3.1/css/swiper.min.css';
  document.head.appendChild(link);
</script>
<script>
  $(function() {
    // Loading arbitrary index file
    $.get('https://s3.amazonaws.com/hubsy-upwork/cam1/resized/sd/idx/last100.txt', function(data) {
      // Populating slides
      $('.swiper-wrapper').html(data.split('\n').map(function(url){
        // Extracting ISO date from URL
        var iso = url.match(/([^\/]+)(?=\.\w+$)/)[0];
        // Converting ISO date
        var title = new Date(iso.slice(0,4) + '-' + iso.slice(4,6) + '-' + iso.slice(6,11) + ':' + iso.slice(11,13) + ':' + iso.slice(13));
        return '<div class="swiper-slide"><img data-src="' + url +  '" class="swiper-lazy"><div class="title">' + title + '</div><div class="swiper-lazy-preloader swiper-lazy-preloader-white"></div></div>'
      }).join(''));

      // Initializing swiper
      var swiper = new Swiper('.swiper-container', {
        nextButton: '.swiper-button-next',
        prevButton: '.swiper-button-prev',
        pagination: '.swiper-pagination',
        paginationClickable: true,
        // Disable preloading of all images
        preloadImages: false,
        // Enable lazy loading
        lazyLoading: true,
        effect: 'fade'
      });
    });
  });
</script>
```
You can find more configuration options in [Swiper Docs](http://idangero.us/swiper/api/).

You can also insert CSS link tag in your html header manualy instead of using stylesheet loader script:
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/Swiper/3.3.1/css/swiper.min.css">
```

Make sure to enable [CORS on your AWS S3 bucket](http://docs.aws.amazon.com/AmazonS3/latest/dev/cors.html). You can use this sample configuration that allows all origins to access your resources:

```xml
<CORSConfiguration>
 <CORSRule>
   <AllowedOrigin>*</AllowedOrigin>
   <AllowedMethod>GET</AllowedMethod>
   <AllowedHeader>*</AllowedHeader>
 </CORSRule>
</CORSConfiguration>
```
*AllowedOrigin* tag can have `*` if you want any website to embed your slideshow or a specific domain name, including http-part, e.g. `http://www.example2.com` to limit it to your website only.
