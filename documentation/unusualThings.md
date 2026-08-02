## The database runs on port 5433, not 5432.
This is to avoid port confilcts if the developer has a seperate instance of postgres on their machine.

## PDF Viewer Does Not Work in Debug Mode
The PDF viewer conflicts with React strict mode (which does every hook twice to ensure no side effects). This strict mode is enabled in the debug build but not in the production build, so the PDF viewer component that shows a PDF only works in production.

## pdfium.wasm is copied from node modules during build
This is done so that if pdfium is updated, the wasm binary is updated without maintainer intervention. The file is copied by scripts/copy-pdfium.mjs

## There is no S3 local testing environment
File uploads done while testing are uploaded to a seperate S3 bucket in the cloud, rather than a local emulator. Consider changing this in the future.

## OCR (Optical Character Recognition)
OCR is currenlty done inside the same container as the server. This means that the server needs a lot of RAM ~2GB, to handle files with images and text---files with just text use substantially less RAM. This substantially increases cost. Consider having OCR done in a seperate container that is only on when OCR is in use.

## Save and Submit system applies to text entries, not labels/dates
Adding labels and dates to information currently requires that the information exists in the information table. This means the information has to have been submitted. However, this does not apply to the text entries.

# Bugs
* At the time of writing, there is a bug where if a user has logged in too long ago, it will not show the login/signup page, it will show the project list page but with no projects listed, just a "not authenticated" message. The user needs to press the logout button to get to the login/sign up page. It should take them there directly, without showing the project list page first.  